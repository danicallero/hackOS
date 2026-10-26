#!/usr/bin/env bash
# Back up PostgreSQL and the MinIO bucket to AWS S3 (#539).
#
# The S3 bucket is intentionally provisioned outside this repository. This
# helper only runs when BACKUPS_ENABLED=true in the deployment environment.
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

backup_backups_enabled="$(env_value BACKUPS_ENABLED)"
backup_backups_enabled="${backup_backups_enabled:-false}"
[[ "$backup_backups_enabled" == true ]] || die "BACKUPS_ENABLED is not true"

s3_region="$(require_value BACKUP_S3_REGION)"
backup_bucket="$(require_value BACKUP_S3_BUCKET)"
backup_prefix="$(require_value BACKUP_S3_PREFIX)"
backup_access_key_id="$(require_value BACKUP_S3_ACCESS_KEY_ID)"
backup_secret_access_key="$(require_value BACKUP_S3_SECRET_ACCESS_KEY)"
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

[[ "$s3_region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || die "BACKUP_S3_REGION is not an AWS region name"
[[ "$backup_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "BACKUP_S3_BUCKET is not a valid bucket name"
[[ "$backup_prefix" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die "BACKUP_S3_PREFIX contains unsafe characters"
[[ "$backup_prefix" != */ && "$backup_prefix" != *..* ]] || die "BACKUP_S3_PREFIX must not end in / or contain .."
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die "IMAGE_TAG must match sha-<40 lowercase hex characters>"
[[ "$data_dir" == /* && "$data_dir" != "/" ]] || die "HACKOS_DATA_DIR must be an absolute path other than /"
[[ "$data_dir" != *$'\n'* && "$data_dir" != *$'\r'* ]] || die "HACKOS_DATA_DIR contains a newline"
if [[ "$environment" == production ]]; then
  command -v mountpoint >/dev/null 2>&1 || die "mountpoint is not available"
  mountpoint -q "$data_dir" || die "production data path is not a mounted persistent volume"
fi

export IMAGE_TAG="$image_tag"
export BACKUP_S3_ENDPOINT="https://s3.$s3_region.amazonaws.com"
export BACKUP_S3_BUCKET="$backup_bucket"
export BACKUP_S3_ACCESS_KEY_ID="$backup_access_key_id"
export BACKUP_S3_SECRET_ACCESS_KEY="$backup_secret_access_key"
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
object_prefix="$backup_prefix/$environment/snapshots/$timestamp"
export BACKUP_S3_OBJECT="$object_prefix/postgres.dump"

run_quiet "validate Compose" compose config --quiet
run_quiet "start backup dependencies" compose up --detach postgres minio
wait_for_health postgres
wait_for_health minio

pg_error="$(mktemp)"
if ! compose exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  2>"$pg_error" |
  compose run --rm --no-deps -T \
    -e BACKUP_S3_ENDPOINT -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY -e BACKUP_S3_BUCKET -e BACKUP_S3_OBJECT \
    --entrypoint /bin/sh minio-init \
    -c 'set -eu
      mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
      mc pipe "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"' \
  >>"$pg_error" 2>&1; then
  rm -f "$pg_error"
  die "PostgreSQL backup failed"
fi
rm -f "$pg_error"

# Objects are written once and keyed by the database, so one incremental mirror
# per environment replaces a full copy per snapshot (S3 storage is billed per
# GB-month). Nothing is removed: a restored database may reference files that
# were deleted after the snapshot. Bucket versioning keeps overwrites recoverable.
export BACKUP_S3_OBJECT_PREFIX="$backup_prefix/$environment/minio"
run_quiet "MinIO backup" compose run --rm --no-deps -T \
  -e BACKUP_S3_ENDPOINT -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY -e BACKUP_S3_BUCKET -e BACKUP_S3_OBJECT_PREFIX \
  --entrypoint /bin/sh minio-init \
  -c 'set -eu
    mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    mc mirror --overwrite "local/$S3_BUCKET" "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT_PREFIX"'

# Restore (#539) reads this to pick the matching app version and to detect a
# truncated upload before touching live data.
export BACKUP_MIGRATION_HEAD="$(compose exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -qtA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "SELECT max(name) FROM public._migrations"' |
  tr -d '[:space:]')"
[[ -n "$BACKUP_MIGRATION_HEAD" ]] || die "could not read the migration head"

# The manifest is written last: its presence marks a complete snapshot.
export BACKUP_S3_OBJECT="$object_prefix/manifest.txt"
export BACKUP_DUMP_OBJECT="$object_prefix/postgres.dump"
export BACKUP_ENVIRONMENT="$environment"
export BACKUP_IMAGE_TAG="$image_tag"
export BACKUP_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
run_quiet "backup manifest" compose run --rm --no-deps -T \
  -e BACKUP_S3_ENDPOINT -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY -e BACKUP_S3_BUCKET -e BACKUP_S3_OBJECT \
  -e BACKUP_DUMP_OBJECT -e BACKUP_MIGRATION_HEAD \
  -e BACKUP_ENVIRONMENT -e BACKUP_IMAGE_TAG -e BACKUP_CREATED_AT \
  --entrypoint /bin/sh minio-init \
  -c 'set -eu
    mc alias set offsite "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
    stat="$(mc stat --json "offsite/$BACKUP_S3_BUCKET/$BACKUP_DUMP_OBJECT")"
    dump_size="$(printf "%s" "$stat" | sed -n "s/.*\"size\":\([0-9]*\).*/\1/p")"
    dump_etag="$(printf "%s" "$stat" | sed -n "s/.*\"etag\":\"\([^\"]*\)\".*/\1/p")"
    [ -n "$dump_size" ] && [ "$dump_size" -gt 0 ] || { echo "empty dump" >&2; exit 1; }
    printf "environment=%s\nimage_tag=%s\nmigration_head=%s\ncreated_at=%s\ndump_size=%s\ndump_etag=%s\n" \
      "$BACKUP_ENVIRONMENT" "$BACKUP_IMAGE_TAG" "$BACKUP_MIGRATION_HEAD" "$BACKUP_CREATED_AT" "$dump_size" "$dump_etag" |
      mc pipe "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"'

echo "OK: S3 backup created at $object_prefix"
