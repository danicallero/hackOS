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

app_dir="${HACKOS_APP_DIR:-/root/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"
validator_file="${HACKOS_CHECK_ENV_FILE:-$app_dir/check-env.sh}"

if [[ ! -f "$compose_file" ]]; then
  echo "ERROR: deployment Compose file is missing" >&2
  exit 1
fi

# Prefer the canonical two-file contract. Keep a compatibility path for an
# existing single secret file in the LXC; Actions never supplies either file.
compose_env_files=()
if [[ -f "$config_file" && -f "$secrets_file" ]]; then
  compose_env_files=(--env-file "$config_file" --env-file "$secrets_file")
elif [[ -f "/etc/hackos/hackos.env" || -f "/etc/hackos/hackos.secrets" ]]; then
  echo "ERROR: both Compose environment files are required" >&2
  exit 1
elif [[ -f "$app_dir/.env.$environment" ]]; then
  compose_env_files=(--env-file "$app_dir/.env.$environment")
elif [[ -f "$app_dir/.env" ]]; then
  compose_env_files=(--env-file "$app_dir/.env")
else
  echo "ERROR: deployment environment and secret file are missing from the LXC" >&2
  exit 1
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

if [[ "${#compose_env_files[@]}" -eq 4 && -x "$validator_file" ]]; then
  validator_output="$(mktemp)"
  if ! "$validator_file" "$config_file" "$secrets_file" "$image_tag" >"$validator_output" 2>&1; then
    rm -f "$validator_output"
    echo "ERROR: deployment environment validation failed" >&2
    exit 1
  fi
  rm -f "$validator_output"
  echo "OK: deployment environment validated"
fi

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
run_compose "pull api worker web" pull api worker web
run_compose "start datastores" up --detach postgres valkey minio
wait_for_health postgres
wait_for_health valkey
wait_for_health minio
run_compose "initialize object storage" run --rm --no-deps minio-init
run_compose "migrate database" run --rm --no-deps migrate
run_compose "update api worker web" up --detach --no-deps --force-recreate api worker web
wait_for_health api
wait_for_health worker
wait_for_health web
echo "OK: hackOS $environment deployed"
