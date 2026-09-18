#!/usr/bin/env bash
# Operate a hackOS Compose project without changing data.
set -Eeuo pipefail

print_help() {
  cat <<'EOF'
Usage:
  services.sh <environment> status [service ...]
  services.sh <environment> logs [--follow] [--tail N] [service ...]
  services.sh <environment> start [service ...]
  services.sh <environment> stop [service ...]
  services.sh <environment> shutdown
  services.sh <environment> shell
  services.sh <environment> superadmin <list|create|grant|revoke> [options]

Environments: staging production
Services: postgres valkey minio minio-init migrate api worker web

The default start/stop operations cover the long-running runtime. shutdown
stops the whole selected project and never removes volumes or bind data.

Superadmin operations use the official server-side scripts in the API image:
  superadmin list
  superadmin create --email user@example.org --password '...' --name Name --surname Surname
  superadmin grant --email user@example.org [--allow-existing-admin]
  superadmin revoke --email user@example.org
EOF
}

usage() {
  local exit_status="${1:-2}"
  if ((exit_status == 0)); then
    print_help
  else
    print_help >&2
  fi
  exit "$exit_status"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
  usage 0
fi
environment="${1:-}"
action="${2:-}"
if (($# < 2)); then
  usage 2
fi
shift 2
case "$environment" in
  staging|production) ;;
  *) usage 2 ;;
esac
case "$action" in
  status|logs|start|stop|shutdown|shell|superadmin) ;;
  -h|--help|help) usage 0 ;;
  *) usage 2 ;;
esac
if [[ "$action" == superadmin && ( "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ) ]]; then
  usage 0
fi

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"

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
  flock -n 9 || die "another hackOS $environment deployment or service operation is running"
}

run_superadmin() {
  local operation="${1:-}"
  shift || true
  local email=""
  local password=""
  local name=""
  local surname=""
  local language=""
  local allow_existing=false
  local script_args=()

  case "$operation" in
    -h|--help|help)
      usage 0
      ;;

    list)
      (($# == 0)) || usage 2
      compose run --rm --no-deps --entrypoint node api scripts/list-superadmins.mjs
      ;;

    create)
      while (($# > 0)); do
        case "$1" in
          --email|--password|--name|--surname|--language)
            local option="$1"
            shift
            (($# > 0)) || die "$option requires a value"
            case "$option" in
              --email) email="$1" ;;
              --password) password="$1" ;;
              --name) name="$1" ;;
              --surname) surname="$1" ;;
              --language) language="$1" ;;
            esac
            ;;
          --allow-existing-admin)
            allow_existing=true
            ;;
          *)
            die "unknown superadmin option: $1"
            ;;
        esac
        shift
      done
      [[ -n "$email" ]] || die "superadmin create requires --email"
      [[ -n "$password" ]] || die "superadmin create requires --password"
      [[ -n "$name" ]] || die "superadmin create requires --name"
      [[ -n "$surname" ]] || die "superadmin create requires --surname"
      if [[ -n "$language" && ! "$language" =~ ^(en|es|gl)$ ]]; then
        die "--language must be en, es, or gl"
      fi
      lock_mutation
      script_args=(dist/create-superadmin.js --email "$email" --password "$password" --name "$name" --surname "$surname")
      [[ -n "$language" ]] && script_args+=(--language "$language")
      [[ "$allow_existing" == true ]] && script_args+=(--allow-existing-admin)
      compose run --rm --no-deps --entrypoint node api "${script_args[@]}"
      ;;

    grant|revoke)
      while (($# > 0)); do
        case "$1" in
          --email)
            shift
            (($# > 0)) || die "--email requires an address"
            email="$1"
            ;;
          --allow-existing-admin)
            [[ "$operation" == grant ]] || die "--allow-existing-admin is only valid for grant"
            allow_existing=true
            ;;
          *)
            die "unknown superadmin option: $1"
            ;;
        esac
        shift
      done
      [[ -n "$email" ]] || die "superadmin $operation requires --email"
      lock_mutation
      if [[ "$operation" == grant ]]; then
        script_args=(scripts/grant-superadmin.mjs --email "$email")
        [[ "$allow_existing" == true ]] && script_args+=(--allow-existing-admin)
      else
        script_args=(scripts/revoke-superadmin.mjs --email "$email")
      fi
      compose run --rm --no-deps --entrypoint node api "${script_args[@]}"
      ;;

    *)
      die "superadmin action must be list, create, grant, or revoke"
      ;;
  esac
}

run_child() {
  local status
  "$0" "$environment" "$@" || {
    status=$?
    echo "Command failed with exit status $status; returning to the menu." >&2
  }
}

superadmin_shell() {
  while true; do
    cat <<EOF

hackOS $environment superadmin management

  1) List superadmins
  2) Set up a new account as superadmin
  3) Grant superadmin to an existing account
  4) Revoke superadmin from an account
  b) Back
EOF
    read -r -p "Select an action: " choice
    case "$choice" in
      1)
        run_child superadmin list
        ;;
      2)
        read -r -p "New account email: " email
        read -r -p "First name: " name
        read -r -p "Surname: " surname
        read -r -s -p "Initial password: " password
        printf '\n'
        if [[ -z "$email" || -z "$name" || -z "$surname" || -z "$password" ]]; then
          echo "Email, name, surname, and password are required."
          continue
        fi
        create_command=(superadmin create --email "$email" --password "$password" --name "$name" --surname "$surname")
        read -r -p "Allow an additional superadmin if one exists? Type ALLOW to confirm: " confirmation
        [[ "$confirmation" == ALLOW ]] && create_command+=(--allow-existing-admin)
        unset password
        run_child "${create_command[@]}"
        unset create_command
        ;;
      3)
        read -r -p "Existing account email: " email
        if [[ -z "$email" ]]; then
          echo "An email address is required."
          continue
        fi
        grant_command=(superadmin grant --email "$email")
        read -r -p "Allow an additional superadmin if one exists? Type ALLOW to confirm: " confirmation
        [[ "$confirmation" == ALLOW ]] && grant_command+=(--allow-existing-admin)
        run_child "${grant_command[@]}"
        ;;
      4)
        read -r -p "Superadmin email to revoke: " email
        if [[ -z "$email" ]]; then
          echo "An email address is required."
          continue
        fi
        run_child superadmin revoke --email "$email"
        ;;
      b|B|back)
        return 0
        ;;
      *)
        echo "Unknown selection: $choice" >&2
        ;;
    esac
  done
}

interactive_shell() {
  [[ -t 0 && -t 1 ]] || die "the interactive shell requires a terminal"

  while true; do
    cat <<EOF

hackOS $environment service shell

  1) Show status
  2) Show logs
  3) Start runtime
  4) Stop selected services
  5) Shutdown all services
  6) Superadmin management
  7) Show help
  q) Quit
EOF
    read -r -p "Select an action: " choice
    case "$choice" in
      1)
        run_child status
        ;;
      2)
        read -r -p "Services (blank for all): " log_services
        read -r -a selected_services <<< "$log_services"
        read -r -p "Follow logs? [y/N]: " follow_logs
        log_command=(logs --tail 200)
        [[ "$follow_logs" == [yY] ]] && log_command+=(--follow)
        log_command+=("${selected_services[@]}")
        run_child "${log_command[@]}"
        ;;
      3)
        run_child start
        ;;
      4)
        read -r -p "Services (blank for all): " stop_services
        read -r -a selected_services <<< "$stop_services"
        run_child stop "${selected_services[@]}"
        ;;
      5)
        read -r -p "Type SHUTDOWN to stop all hackOS $environment services: " confirmation
        if [[ "$confirmation" == SHUTDOWN ]]; then
          run_child shutdown
        else
          echo "Shutdown cancelled."
        fi
        ;;
      6)
        superadmin_shell
        ;;
      7)
        print_help
        ;;
      q|Q|quit|exit)
        return 0
        ;;
      *)
        echo "Unknown selection: $choice" >&2
        ;;
    esac
  done
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

  superadmin)
    run_superadmin "$@"
    ;;

  shell)
    (($# == 0)) || usage 2
    interactive_shell
    ;;
esac
