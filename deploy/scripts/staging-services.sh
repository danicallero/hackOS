#!/usr/bin/env bash
# Operate the staging hackOS Compose project without changing data.
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  staging-services.sh status [service ...]
  staging-services.sh logs [--follow] [--tail N] [service ...]
  staging-services.sh start [service ...]
  staging-services.sh stop [service ...]
  staging-services.sh shutdown

Services: postgres valkey minio minio-init migrate api worker web

The default start/stop operations cover the long-running runtime. shutdown is
an alias for stopping the whole project and never removes volumes or bind data.
EOF
  exit 2
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

action="${1:-}"
shift || true
case "$action" in
  status|logs|start|stop|shutdown) ;;
  *) usage ;;
esac

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="${HACKOS_COMPOSE_PROJECT_NAME:-hackos-staging}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"

[[ "$project_name" == hackos-staging ]] || die "this helper only operates the staging Compose project"
[[ -f "$compose_file" ]] || die "Compose file is missing: $compose_file"
command -v docker >/dev/null 2>&1 || die "Docker is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available"

require_private_file() {
  local file="$1"
  local mode

  if mode="$(stat -c '%a' "$file" 2>/dev/null)"; then
    :
  else
    mode="$(stat -f '%Lp' "$file" 2>/dev/null || true)"
  fi
  [[ "$mode" == 600 ]] || die "environment secret file must have mode 600: $file"
}

compose_env_files=()
if [[ -f "$config_file" && -f "$secrets_file" ]]; then
  compose_env_files=(--env-file "$config_file" --env-file "$secrets_file")
  require_private_file "$secrets_file"
elif [[ -f "$config_file" ]]; then
  compose_env_files=(--env-file "$config_file")
  require_private_file "$config_file"
else
  die "environment file is missing: $config_file"
fi

compose() {
  docker compose \
    "${compose_env_files[@]}" \
    --file "$compose_file" \
    --project-name "$project_name" \
    "$@"
}

all_services=(postgres valkey minio minio-init migrate api worker web)
runtime_services=(postgres valkey minio api worker web)

validate_services() {
  local service candidate candidate_service
  for service in "$@"; do
    candidate=false
    for candidate_service in "${all_services[@]}"; do
      if [[ "$service" == "$candidate_service" ]]; then
        candidate=true
        break
      fi
    done
    [[ "$candidate" == true ]] || die "unknown service: $service"
  done
}

lock_mutation() {
  mkdir -p "$app_dir"
  command -v flock >/dev/null 2>&1 || die "flock is not available"
  exec 9>"$lock_file"
  flock -n 9 || die "another hackOS deployment or service operation is running"
}

case "$action" in
  status)
    validate_services "$@"
    if (($# == 0)); then
      compose ps --all
    else
      compose ps --all "$@"
    fi
    ;;

  logs)
    follow=false
    tail_lines="${HACKOS_LOG_TAIL:-200}"
    services=()
    while (($# > 0)); do
      case "$1" in
        --follow|-f)
          follow=true
          ;;
        --tail)
          shift
          (($# > 0)) || die "--tail requires a line count"
          tail_lines="$1"
          ;;
        --tail=*)
          tail_lines="${1#*=}"
          ;;
        --)
          shift
          services+=("$@")
          break
          ;;
        -*)
          die "unknown logs option: $1"
          ;;
        *)
          services+=("$1")
          ;;
      esac
      shift
    done
    [[ "$tail_lines" =~ ^[0-9]+$ ]] || die "log line count must be a non-negative integer"
    validate_services "${services[@]}"
    log_args=(logs --timestamps --tail "$tail_lines")
    [[ "$follow" == true ]] && log_args+=(--follow)
    log_args+=("${services[@]}")
    compose "${log_args[@]}"
    ;;

  start)
    validate_services "$@"
    lock_mutation
    if (($# == 0)); then
      compose up --detach --no-build --wait --wait-timeout 120 "${runtime_services[@]}"
    else
      compose up --detach --no-build --wait --wait-timeout 120 "$@"
    fi
    compose ps --all
    ;;

  stop)
    validate_services "$@"
    lock_mutation
    if (($# == 0)); then
      compose stop
    else
      compose stop "$@"
    fi
    ;;

  shutdown)
    (($# == 0)) || usage
    lock_mutation
    echo "Stopping $project_name; persistent data is retained."
    compose stop
    ;;
esac
