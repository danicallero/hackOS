#!/usr/bin/env bash
# Deploy one immutable hackOS image set on a Docker host. The same script is
# used by the production Linux/x86_64 LXC and the ARM64 staging host.
set -Eeuo pipefail

environment="${1:-}"
image_tag="${2:-current}"
deploy_api="${3:-true}"
deploy_web="${4:-true}"
current_mode=false

case "$environment" in
  production|staging) ;;
  *)
    echo "ERROR: environment must be production or staging" >&2
    exit 2
    ;;
esac

case "$deploy_api" in
  true|false) ;;
  *)
    echo "ERROR: API deployment flag must be true or false" >&2
    exit 2
    ;;
esac
case "$deploy_web" in
  true|false) ;;
  *)
    echo "ERROR: web deployment flag must be true or false" >&2
    exit 2
    ;;
esac

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"
validator_file="${HACKOS_CHECK_ENV_FILE:-$app_dir/check-env.sh}"
backup_file="${HACKOS_BACKUP_FILE:-$app_dir/backup-r2.sh}"
release_root="${HACKOS_RELEASE_DIR:-$app_dir/releases}"

if [[ "$image_tag" == current ]]; then
  current_mode=true
  if [[ ! -r "$config_file" ]]; then
    echo "ERROR: cannot resolve current image tag; configuration file is missing" >&2
    exit 1
  fi
  image_tag="$(awk -F= '$1 == "IMAGE_TAG" { value = $2 } END { print value }' "$config_file")"
fi

if [[ ! "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "ERROR: image tag must match sha-<40 lowercase hex characters> (or use current)" >&2
  exit 2
fi

if [[ ! -f "$compose_file" ]]; then
  echo "ERROR: deployment Compose file is missing" >&2
  exit 1
fi

# Production uses one file; staging uses the existing pair.
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
  echo "ERROR: /etc/hackos environment files are missing from the deployment host" >&2
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
  echo "ERROR: Docker Compose is not available on the deployment host" >&2
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  echo "ERROR: flock is not available on the deployment host" >&2
  exit 1
fi

if [[ "${HACKOS_LOCK_HELD:-false}" != true ]]; then
  mkdir -p "$app_dir"
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "ERROR: another hackOS deployment is already running" >&2
    exit 1
  fi
fi

export COMPOSE_PROJECT_NAME="$project_name"
export IMAGE_TAG="$image_tag"
# Set safe initial values so `compose ps` can inspect the currently running
# services before the partial-release tags are resolved below.
export API_IMAGE_TAG="$image_tag"
export WEB_IMAGE_TAG="$image_tag"

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

state_file="${HACKOS_IMAGE_STATE_FILE:-$app_dir/.image-tags}"

state_value() {
  local key="$1"
  [[ -r "$state_file" ]] || return 0
  awk -v key="$key" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      split(line, fields, "=")
      if (fields[1] == key) {
        sub(/^[^=]*=/, "", line)
        value = line
      }
    }
    END {
      value = value ? value : ""
      value = value ~ /^".*"$/ ? substr(value, 2, length(value) - 2) : value
      print value
    }
  ' "$state_file"
}

valid_image_tag() {
  [[ "$1" =~ ^sha-[0-9a-f]{40}$ ]]
}

running_image_tag() {
  local service="$1"
  local container_id image
  container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
  [[ -n "$container_id" ]] || return 1
  image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null || true)"
  if [[ "$image" =~ :((sha-)[0-9a-f]{40})$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

resolve_existing_tag() {
  local service="$1"
  local key="$2"
  local fallback="$3"
  local tag

  tag="$(running_image_tag "$service" || true)"
  if valid_image_tag "$tag"; then
    printf '%s\n' "$tag"
    return 0
  fi

  tag="$(state_value "$key")"
  if valid_image_tag "$tag"; then
    printf '%s\n' "$tag"
    return 0
  fi

  tag="$(env_value "$key")"
  if valid_image_tag "$tag"; then
    printf '%s\n' "$tag"
    return 0
  fi

  if valid_image_tag "$fallback"; then
    printf '%s\n' "$fallback"
    return 0
  fi

  echo "ERROR: cannot resolve the current $service image tag" >&2
  return 1
}

if [[ "$current_mode" == true || "$deploy_api" == true ]]; then
  if [[ "$current_mode" == true ]]; then
    api_image_tag="$(resolve_existing_tag api API_IMAGE_TAG "$image_tag")"
  else
    api_image_tag="$image_tag"
  fi
else
  api_image_tag="$(resolve_existing_tag api API_IMAGE_TAG "$image_tag")"
fi

if [[ "$current_mode" == true || "$deploy_web" == true ]]; then
  if [[ "$current_mode" == true ]]; then
    web_image_tag="$(resolve_existing_tag web WEB_IMAGE_TAG "$image_tag")"
  else
    web_image_tag="$image_tag"
  fi
else
  web_image_tag="$(resolve_existing_tag web WEB_IMAGE_TAG "$image_tag")"
fi

export API_IMAGE_TAG="$api_image_tag"
export WEB_IMAGE_TAG="$web_image_tag"

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

phase() {
  printf '\n==> %s\n' "$1"
}

verify_pulled_image_revision() {
  local service="$1" tag="$2" image expected_revision revision

  case "$service" in
    api) image="ghcr.io/danicallero/hackos-api:$tag" ;;
    web) image="ghcr.io/danicallero/hackos-web:$tag" ;;
    *)
      echo "ERROR: cannot verify unknown image service: $service" >&2
      exit 1
      ;;
  esac
  expected_revision="${tag#sha-}"
  revision="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image" 2>/dev/null || true)"
  if [[ "$revision" != "$expected_revision" ]]; then
    echo "ERROR: pulled $service image does not match requested release $tag" >&2
    exit 1
  fi
  echo "OK: pulled $service image revision matches $tag"
}

if [[ ! -x "$validator_file" ]]; then
  echo "ERROR: deployment environment validator is missing or not executable" >&2
  exit 1
fi
validator_output="$(mktemp)"
if ! "$validator_file" "$validator_config" "$validator_secrets" "$image_tag" "$api_image_tag" "$web_image_tag" >"$validator_output" 2>&1; then
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
printf 'api_image_tag=%s\nweb_image_tag=%s\n' \
  "$api_image_tag" \
  "$web_image_tag" >>"$release_dir/metadata"
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
phase "Checking deployment configuration"
run_compose "validate Compose" config --quiet
phase "Refreshing selected immutable images from GHCR"
pull_targets=()
if [[ "$deploy_api" == true ]]; then
  # These three services share the immutable API image. Do not refresh the
  # infrastructure images here: staging keeps its healthy datastore images and
  # a registry outage there must not block an application-only release.
  pull_targets+=(api worker migrate)
fi
if [[ "$deploy_web" == true ]]; then
  pull_targets+=(web)
fi
if ((${#pull_targets[@]})); then
  pull_output="$(mktemp)"
  if ! compose pull --policy always "${pull_targets[@]}" >"$pull_output" 2>&1; then
    echo "ERROR: pull pinned images failed" >&2
    cat "$pull_output" >&2
    rm -f "$pull_output"
    exit 1
  fi
  rm -f "$pull_output"
  echo "OK: pull pinned images"
else
  echo "OK: no application images selected for refresh"
fi
if [[ "$deploy_api" == true ]]; then
  verify_pulled_image_revision api "$api_image_tag"
fi
if [[ "$deploy_web" == true ]]; then
  verify_pulled_image_revision web "$web_image_tag"
fi
phase "Starting database, queue, and object storage"
run_compose "start datastores" up --detach postgres valkey minio
wait_for_health postgres
wait_for_health valkey
wait_for_health minio
phase "Checking object storage"
run_compose "initialize object storage" run --rm --no-deps minio-init
if [[ "$deploy_api" == true && "$(env_value R2_BACKUPS_ENABLED)" == true ]]; then
  if [[ ! -x "$backup_file" ]]; then
    echo "ERROR: R2 backups are enabled but $backup_file is missing" >&2
    exit 1
  fi
  echo "BACKUP: creating R2 backup before migration"
  HACKOS_LOCK_HELD=true "$backup_file" "$environment"
fi
if [[ "$deploy_api" == true ]]; then
  phase "Applying database migrations"
  run_compose "migrate database" run --rm --no-deps migrate
  phase "Recreating API and worker"
  run_compose "update api and worker" up --detach --no-deps --force-recreate api worker
  wait_for_health api
  wait_for_health worker
else
  echo "SKIP: API and worker unchanged"
fi
if [[ "$deploy_web" == true ]]; then
  phase "Recreating web"
  run_compose "update web" up --detach --no-deps --force-recreate web
  wait_for_health web
else
  echo "SKIP: web unchanged"
fi

state_tmp="$(mktemp "${state_file}.XXXXXX")"
printf 'API_IMAGE_TAG=%s\nWEB_IMAGE_TAG=%s\n' \
  "$api_image_tag" \
  "$web_image_tag" >"$state_tmp"
chmod 0600 "$state_tmp"
mv -f "$state_tmp" "$state_file"
echo "OK: hackOS $environment deployed"
