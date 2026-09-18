#!/usr/bin/env bash
# Back up PostgreSQL and the MinIO bucket to Cloudflare R2.
#
# The R2 bucket is intentionally provisioned outside this repository. This
# helper only runs when R2_BACKUPS_ENABLED=true in the deployment environment.
set -Eeuo pipefail

environment="${1:-production}"
case "$environment" in
  production|staging) ;;
  *)
    echo "ERROR: environment must be production or staging" >&2
    exit 2
    ;;
esac

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"

die() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -f "$compose_file" ]] || die "deployment Compose file is missing"

compose_env_files=()
env_files=()
if [[ -f "$config_file" && -f "$secrets_file" ]]; then
  compose_env_files=(--env-file "$config_file" --env-file "$secrets_file")
  env_files=("$config_file" "$secrets_file")
elif [[ -f "$config_file" ]]; then
  compose_env_files=(--env-file "$config_file")
  env_files=("$config_file")
elif [[ -f "$secrets_file" ]]; then
  die "configuration file is missing; a secrets file cannot be used alone"
else
  die "/etc/hackos environment files are missing"
fi

require_private_file() {
  local file="$1"
  local mode

  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")"
  [[ "$mode" == 600 ]] || die "secret environment file must have mode 600: $file"
}

if [[ "${#env_files[@]}" -eq 1 ]]; then
  require_private_file "${env_files[0]}"
else
  require_private_file "$secrets_file"
fi

command -v docker >/dev/null 2>&1 || die "Docker is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available"
command -v flock >/dev/null 2>&1 || die "flock is not available"

if [[ "${HACKOS_LOCK_HELD:-false}" != true ]]; then
  mkdir -p "$app_dir"
  exec 9>"$lock_file"
  flock -n 9 || die "another hackOS operation is already running"
fi

env_value() {
  local key="$1"
  local file entry value
  local index

  for ((index = ${#env_files[@]} - 1; index >= 0; index--)); do
    file="${env_files[index]}"
    entry="$(awk -v key="$key" '
      /^[[:space:]]*(#|$)/ { next }
      {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        split(line, fields, "=")
        if (fields[1] == key) {
          sub(/^[^=]*=/, "", line)
          value = line
          found = 1
        }
      }
      END { printf "%d\t%s", found ? 1 : 0, value }
    ' "$file")"
    if [[ "${entry%%$'\t'*}" == 1 ]]; then
      value="${entry#*$'\t'}"
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      printf '%s' "$value"
      return 0
    fi
  done
}

require_value() {
  local key="$1"
  local result
  result="$(env_value "$key")"
  [[ -n "$result" ]] || die "$key is missing or empty"
  [[ "$result" != *CHANGE_ME* ]] || die "$key still contains CHANGE_ME"
  [[ "$result" != *REPLACE_WITH* ]] || die "$key still contains REPLACE_WITH"
  printf '%s' "$result"
}

r2_backups_enabled="$(env_value R2_BACKUPS_ENABLED)"
r2_backups_enabled="${r2_backups_enabled:-false}"
[[ "$r2_backups_enabled" == true ]] || die "R2_BACKUPS_ENABLED is not true"

r2_endpoint="$(require_value R2_ENDPOINT)"
r2_bucket="$(require_value R2_BUCKET)"
r2_prefix="$(require_value R2_PREFIX)"
r2_access_key_id="$(require_value R2_ACCESS_KEY_ID)"
r2_secret_access_key="$(require_value R2_SECRET_ACCESS_KEY)"
postgres_user="$(require_value POSTGRES_USER)"
postgres_db="$(require_value POSTGRES_DB)"
postgres_password="$(require_value POSTGRES_PASSWORD)"
minio_root_user="$(require_value MINIO_ROOT_USER)"
minio_root_password="$(require_value MINIO_ROOT_PASSWORD)"
s3_bucket="$(env_value S3_BUCKET)"
s3_bucket="${s3_bucket:-hackos}"
image_tag="${IMAGE_TAG:-$(env_value IMAGE_TAG)}"
data_dir="$(env_value HACKOS_DATA_DIR)"
data_dir="${data_dir:-/mnt/data}"

[[ "$r2_endpoint" =~ ^https://[A-Za-z0-9.-]+$ ]] || die "R2_ENDPOINT must be an https host URL"
[[ "$r2_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "R2_BUCKET is not a valid bucket name"
[[ "$r2_prefix" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die "R2_PREFIX contains unsafe characters"
[[ "$r2_prefix" != */ && "$r2_prefix" != *..* ]] || die "R2_PREFIX must not end in / or contain .."
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die "IMAGE_TAG must match sha-<40 lowercase hex characters>"
[[ "$data_dir" == /* && "$data_dir" != "/" ]] || die "HACKOS_DATA_DIR must be an absolute path other than /"
[[ "$data_dir" != *$'\n'* && "$data_dir" != *$'\r'* ]] || die "HACKOS_DATA_DIR contains a newline"
if [[ "$environment" == production ]]; then
  command -v mountpoint >/dev/null 2>&1 || die "mountpoint is not available"
  mountpoint -q "$data_dir" || die "production data path is not a mounted persistent volume"
fi

export IMAGE_TAG="$image_tag"
export R2_ENDPOINT="$r2_endpoint"
export R2_BUCKET="$r2_bucket"
export R2_ACCESS_KEY_ID="$r2_access_key_id"
export R2_SECRET_ACCESS_KEY="$r2_secret_access_key"
export S3_BUCKET="$s3_bucket"
export POSTGRES_USER="$postgres_user"
export POSTGRES_DB="$postgres_db"
export POSTGRES_PASSWORD="$postgres_password"
export MINIO_ROOT_USER="$minio_root_user"
export MINIO_ROOT_PASSWORD="$minio_root_password"

compose() {
  docker compose \
    "${compose_env_files[@]}" \
    --file "$compose_file" \
    --project-name "$project_name" \
    "$@"
}

run_quiet() {
  local description="$1"
  shift
  local output_file
  output_file="$(mktemp)"
  if ! "$@" >"$output_file" 2>&1; then
    rm -f "$output_file"
    die "$description failed"
  fi
  rm -f "$output_file"
}

wait_for_health() {
  local service="$1"
  local container_id status attempt

  for attempt in {1..60}; do
    container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy) die "$service healthcheck reported unhealthy" ;;
      esac
    fi
    sleep 2
  done

  die "$service healthcheck timed out"
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_prefix="$r2_prefix/$environment/$timestamp"
export R2_OBJECT="$object_prefix/postgres.dump"

run_quiet "validate Compose" compose config --quiet
run_quiet "start backup dependencies" compose up --detach postgres minio
wait_for_health postgres
wait_for_health minio

pg_error="$(mktemp)"
if ! compose exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  2>"$pg_error" |
  compose run --rm --no-deps -T \
    -e R2_ENDPOINT -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_BUCKET -e R2_OBJECT \
    --entrypoint /bin/sh minio-init \
    -c 'set -eu
      mc alias set r2 "$R2_ENDPOINT" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" >/dev/null
      mc pipe "r2/$R2_BUCKET/$R2_OBJECT"' \
  >>"$pg_error" 2>&1; then
  rm -f "$pg_error"
  die "PostgreSQL backup failed"
fi
rm -f "$pg_error"

export R2_OBJECT_PREFIX="$object_prefix"
run_quiet "MinIO backup" compose run --rm --no-deps -T \
  -e R2_ENDPOINT -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_BUCKET -e R2_OBJECT_PREFIX \
  --entrypoint /bin/sh minio-init \
  -c 'set -eu
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc alias set r2 "$R2_ENDPOINT" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" >/dev/null
    mc mirror --overwrite "local/$S3_BUCKET" "r2/$R2_BUCKET/$R2_OBJECT_PREFIX/minio"'

export R2_OBJECT="$object_prefix/manifest.txt"
export R2_ENVIRONMENT="$environment"
export R2_IMAGE_TAG="$image_tag"
export R2_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
run_quiet "backup manifest" compose run --rm --no-deps -T \
  -e R2_ENDPOINT -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_BUCKET -e R2_OBJECT \
  -e R2_ENVIRONMENT -e R2_IMAGE_TAG -e R2_CREATED_AT \
  --entrypoint /bin/sh minio-init \
  -c 'set -eu
    mc alias set r2 "$R2_ENDPOINT" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" >/dev/null
    printf "environment=%s\\nimage_tag=%s\\ncreated_at=%s\\n" "$R2_ENVIRONMENT" "$R2_IMAGE_TAG" "$R2_CREATED_AT" |
      mc pipe "r2/$R2_BUCKET/$R2_OBJECT"'

echo "OK: R2 backup created at $object_prefix"
