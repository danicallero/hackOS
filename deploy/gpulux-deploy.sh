#!/usr/bin/env bash
# Deploy one immutable hackOS image set inside the GPULux hackos LXC.
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
if [[ -n "${HACKOS_SECRETS_FILE:-}" ]]; then
  secrets_file="$HACKOS_SECRETS_FILE"
elif [[ -f "$app_dir/.env.$environment" ]]; then
  secrets_file="$app_dir/.env.$environment"
else
  secrets_file="$app_dir/.env"
fi
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"

if [[ ! -f "$compose_file" ]]; then
  echo "ERROR: deployment Compose file is missing" >&2
  exit 1
fi
if [[ ! -f "$secrets_file" ]]; then
  echo "ERROR: deployment secret file is missing from the LXC" >&2
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

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "ERROR: another hackOS deployment is already running" >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="$project_name"
export IMAGE_TAG="$image_tag"

compose() {
  docker compose \
    --env-file "$secrets_file" \
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

wait_for_running() {
  local service="$1"
  local container_id status attempt

  echo "WAIT: process $service"
  for attempt in {1..30}; do
    container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || true)"
      if [[ "$status" == running ]]; then
        echo "OK: process $service"
        return 0
      fi
    fi
    sleep 2
  done

  echo "ERROR: process $service did not start" >&2
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
wait_for_health web
wait_for_running worker
echo "OK: hackOS $environment deployed"
