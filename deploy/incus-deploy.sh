#!/usr/bin/env bash
# Deploy one immutable hackOS image set inside the hackos LXC.
set -Eeuo pipefail

environment="${1:-}"
image_tag="${2:-}"

case "$environment" in
  production|staging) ;;
  *)
    echo "ERROR: environment must be production or staging" >&2
    exit 2
    ;;
esac

if [[ ! "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "ERROR: image tag must match sha-<40 lowercase hex characters>" >&2
  exit 2
fi

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"
validator_file="${HACKOS_CHECK_ENV_FILE:-$app_dir/check-env.sh}"
backup_file="${HACKOS_BACKUP_FILE:-$app_dir/backup-r2.sh}"
release_root="${HACKOS_RELEASE_DIR:-$app_dir/releases}"

if [[ ! -f "$compose_file" ]]; then
  echo "ERROR: deployment Compose file is missing" >&2
  exit 1
fi

# Prefer the canonical two-file contract. The existing GPULux host currently
# provides one chmod-600 combined file, so accept that shape explicitly until
# the host-side integration is published. Do not silently accept a lone
# plaintext configuration file.
compose_env_files=()
env_files=()
validator_config="$config_file"
validator_secrets="$secrets_file"
if [[ -f "$config_file" && -f "$secrets_file" ]]; then
  compose_env_files=(--env-file "$config_file" --env-file "$secrets_file")
  env_files=("$config_file" "$secrets_file")
elif [[ -f "$config_file" ]]; then
  compose_env_files=(--env-file "$config_file")
  env_files=("$config_file")
  validator_secrets="$config_file"
elif [[ -f "$secrets_file" ]]; then
  echo "ERROR: configuration file is missing; a secrets file cannot be used alone" >&2
  exit 1
else
  echo "ERROR: /etc/hackos environment files are missing from the LXC" >&2
  exit 1
fi

require_private_file() {
  local file="$1"
  local mode

  if mode="$(stat -c '%a' "$file" 2>/dev/null)"; then
    :
  else
    mode="$(stat -f '%Lp' "$file" 2>/dev/null || true)"
  fi
  [[ "$mode" == 600 ]] || {
    echo "ERROR: secret environment file must have mode 600: $file" >&2
    exit 1
  }
}

if [[ "$validator_config" == "$validator_secrets" ]]; then
  require_private_file "$validator_config"
else
  require_private_file "$validator_secrets"
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose is not available in the LXC" >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo "ERROR: flock is not available in the LXC" >&2
  exit 1
fi

mkdir -p "$app_dir"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "ERROR: another hackOS deployment is already running" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="$project_name"
export IMAGE_TAG="$image_tag"

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

compose() {
  docker compose \
    "${compose_env_files[@]}" \
    --file "$compose_file" \
    --project-name "$project_name" \
    "$@"
}

run_compose() {
  local description="$1"
  shift
  local output_file
  output_file="$(mktemp)"

  if ! compose "$@" >"$output_file" 2>&1; then
    rm -f "$output_file"
    echo "ERROR: $description failed" >&2
    return 1
  fi

  rm -f "$output_file"
  echo "OK: $description"
}

if [[ ! -x "$validator_file" ]]; then
  echo "ERROR: deployment environment validator is missing or not executable" >&2
  exit 1
fi
validator_output="$(mktemp)"
if ! "$validator_file" "$validator_config" "$validator_secrets" "$image_tag" >"$validator_output" 2>&1; then
  rm -f "$validator_output"
  echo "ERROR: deployment environment validation failed" >&2
  exit 1
fi
rm -f "$validator_output"
echo "OK: deployment environment validated"

data_dir="$(env_value HACKOS_DATA_DIR)"
data_dir="${data_dir:-/mnt/data}"
if [[ "$data_dir" != /* || "$data_dir" == "/" || "$data_dir" == *$'\n'* || "$data_dir" == *$'\r'* ]]; then
  echo "ERROR: HACKOS_DATA_DIR must be an absolute path other than /" >&2
  exit 1
fi
if [[ "$environment" == production ]]; then
  if ! command -v mountpoint >/dev/null 2>&1 || ! mountpoint -q "$data_dir"; then
    echo "ERROR: production data path is not a mounted persistent volume: $data_dir" >&2
    exit 1
  fi
fi
mkdir -p "$data_dir/postgres" "$data_dir/minio"

release_dir="$release_root/$image_tag"
mkdir -p "$release_dir"
install -m 0644 "$compose_file" "$release_dir/docker-compose.yml"
install -m 0700 "$validator_file" "$release_dir/check-env.sh"
install -m 0700 "${BASH_SOURCE[0]}" "$release_dir/deploy.sh"
if [[ -f "$backup_file" ]]; then
  install -m 0700 "$backup_file" "$release_dir/backup-r2.sh"
fi
printf 'environment=%s\nimage_tag=%s\ndeployed_at=%s\n' \
  "$environment" \
  "$image_tag" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$release_dir/metadata"
chmod 0640 "$release_dir/metadata"

wait_for_health() {
  local service="$1"
  local container_id status attempt

  echo "WAIT: healthcheck $service"
  for attempt in {1..60}; do
    container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
      case "$status" in
        healthy)
          echo "OK: healthcheck $service"
          return 0
          ;;
        unhealthy)
          echo "ERROR: healthcheck $service reported unhealthy" >&2
          return 1
          ;;
      esac
    fi
    sleep 2
  done

  echo "ERROR: healthcheck $service timed out" >&2
  return 1
}

echo "Deploying hackOS $environment ($image_tag)"
run_compose "validate Compose" config --quiet
run_compose "pull pinned images" pull
run_compose "start datastores" up --detach postgres valkey minio
wait_for_health postgres
wait_for_health valkey
wait_for_health minio
run_compose "initialize object storage" run --rm --no-deps minio-init
if [[ "$(env_value R2_BACKUPS_ENABLED)" == true ]]; then
  if [[ ! -x "$backup_file" ]]; then
    echo "ERROR: R2 backups are enabled but $backup_file is missing" >&2
    exit 1
  fi
  echo "BACKUP: creating R2 backup before migration"
  HACKOS_LOCK_HELD=true "$backup_file" "$environment"
fi
run_compose "migrate database" run --rm --no-deps migrate
run_compose "update api worker web" up --detach --no-deps --force-recreate api worker web
wait_for_health api
wait_for_health worker
wait_for_health web
echo "OK: hackOS $environment deployed"
