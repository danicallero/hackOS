#!/usr/bin/env bash
# Operate a hackOS Compose project without changing data.
set -Eeuo pipefail

print_help() {
  cat <<'EOF'
Usage:
  services.sh <environment> status [service ...]
  services.sh <environment> logs [--follow] [--tail N] [--event-type TYPE] [--match TEXT] [service ...]
  services.sh <environment> start [service ...]
  services.sh <environment> stop [service ...]
  services.sh <environment> shutdown
  services.sh <environment> shell
  services.sh <environment> superadmin <list|create|grant|revoke> [options]

Environments: staging production
Services: postgres valkey minio minio-init migrate api worker web

The default start/stop operations cover the long-running runtime. shutdown
stops the whole selected project and never removes volumes or bind data.

Log event types: all, error, warning, request, health. Use --match TEXT for a
case-insensitive literal search instead of a built-in event type.

Superadmin operations use the official server-side scripts in the API image:
  superadmin list
  superadmin create --email user@example.org [--password '...' | --password-stdin] --name Name --surname Surname
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

terminal_setup() {
  if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    c_reset=$'\033[0m'
    c_bold=$'\033[1m'
    c_dim=$'\033[2m'
    c_cyan=$'\033[36m'
    c_green=$'\033[32m'
    c_red=$'\033[31m'
    c_yellow=$'\033[33m'
    c_blue=$'\033[34m'
    c_magenta=$'\033[35m'
  else
    c_reset=''
    c_bold=''
    c_dim=''
    c_cyan=''
    c_green=''
    c_red=''
    c_yellow=''
    c_blue=''
    c_magenta=''
  fi
}

clear_shell() {
  [[ "${HACKOS_SHELL_NO_CLEAR:-}" == true ]] || printf '\033[2J\033[H'
}

pause_shell() {
  read -r -p "${c_dim}Press Enter to return to the menu...${c_reset}" _ || true
}

read_shell_input() {
  local prompt="$1"
  local mode="${2:-plain}"

  shell_input=''
  shell_navigation=value
  if [[ "$mode" == silent ]]; then
    if ! read -r -s -p "$prompt" shell_input; then
      shell_navigation=quit
    fi
    printf '\n'
  elif ! read -r -p "$prompt" shell_input; then
    shell_navigation=quit
  fi

  case "$shell_input" in
    [Bb]|[Bb][Aa][Cc][Kk])
      shell_input=''
      shell_navigation=back
      ;;
    [Qq]|[Qq][Uu][Ii][Tt]|[Ee][Xx][Ii][Tt])
      shell_input=''
      shell_navigation=quit
      ;;
  esac
}

print_shell_help() {
  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · help${c_reset}"
  printf '%s\n' "${c_bold}Service commands${c_reset}"
  printf '%s\n' "  status       Show service state, health, and published ports."
  printf '%s\n' "  logs         Show colored logs; add --follow, --tail N, or --event-type."
  printf '%s\n' "               Event types: all, error, warning, request, health."
  printf '%s\n' "               Use --match TEXT for a case-insensitive literal search."
  printf '%s\n' "  start        Start the runtime and wait for health checks."
  printf '%s\n' "  stop         Stop all services or named services."
  printf '%s\n' "  shutdown     Stop the whole project; persistent data is retained."
  printf '\n%s\n' "${c_bold}Superadmin commands${c_reset}"
  printf '%s\n' "  superadmin list"
  printf '%s\n' "  superadmin create --email ... [--password-stdin] --name ... --surname ..."
  printf '%s\n' "  superadmin grant --email ... [--allow-existing-admin]"
  printf '%s\n' "  superadmin revoke --email ..."
  printf '\n%s\n' "${c_dim}Arrow keys move through menus; Enter selects; number keys are shortcuts."
  printf '%s\n' "b goes back and q exits from menus and data-entry prompts."
  printf '%s\n' "Superadmin operations call the audited server-side scripts in the API image."
  printf '%s\n' "Service actions do not build images; an admin command pulls quietly only if needed."
  printf '%s\n' "Environment values are not printed or edited in this menu; use sudoedit + check-env.sh."
  printf '%s\n' "Use Ctrl-C to leave a following log stream.${c_reset}"
  pause_shell
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

run_api_script() {
  if compose ps --status running --services api 2>/dev/null | grep -Fxq api; then
    compose exec --no-TTY api node "$@"
  else
    compose run --quiet-pull --rm --no-deps --entrypoint node api "$@"
  fi
}

all_services=(postgres valkey minio minio-init migrate api worker web)
runtime_services=(postgres valkey minio api worker web)
service_status_format='table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}'

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
  local password_from_stdin=false
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
      run_api_script scripts/list-superadmins.mjs
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
          --password-stdin)
            password_from_stdin=true
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
      if [[ -n "$password" && "$password_from_stdin" == true ]]; then
        die "use either --password or --password-stdin, not both"
      fi
      if [[ -z "$password" && "$password_from_stdin" != true ]]; then
        die "superadmin create requires --password or --password-stdin"
      fi
      [[ -n "$name" ]] || die "superadmin create requires --name"
      [[ -n "$surname" ]] || die "superadmin create requires --surname"
      if [[ -n "$language" && ! "$language" =~ ^(en|es|gl)$ ]]; then
        die "--language must be en, es, or gl"
      fi
      lock_mutation
      script_args=(dist/create-superadmin.js --email "$email" --password "$password" --name "$name" --surname "$surname")
      if [[ "$password_from_stdin" == true ]]; then
        script_args=(dist/create-superadmin.js --email "$email" --password-stdin --name "$name" --surname "$surname")
      fi
      [[ -n "$language" ]] && script_args+=(--language "$language")
      [[ "$allow_existing" == true ]] && script_args+=(--allow-existing-admin)
      run_api_script "${script_args[@]}"
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
      run_api_script "${script_args[@]}"
      ;;

    *)
      die "superadmin action must be list, create, grant, or revoke"
      ;;
  esac
}

restore_menu_terminal() {
  if [[ -n "${menu_tty_state:-}" ]]; then
    stty "$menu_tty_state" 2>/dev/null || true
    menu_tty_state=''
  fi
}

render_menu() {
  local title="$1"
  local subtitle="$2"
  local selected="$3"
  shift 3
  local options=("$@")
  local index

  clear_shell
  printf '%s\n' "${c_cyan}${c_bold}hackOS ${environment} · ${title}${c_reset}"
  printf '%s\n' "${c_dim}${subtitle}${c_reset}"
  printf '%s\n\n' "${c_cyan}────────────────────────────────────────────────────────────${c_reset}"
  for index in "${!options[@]}"; do
    if ((index == selected)); then
      printf '  %s%s▸ %d  %s%s\n' "$c_cyan" "$c_bold" "$((index + 1))" "${options[index]}" "$c_reset"
    else
      printf '    %d  %s\n' "$((index + 1))" "${options[index]}"
    fi
  done
  printf '\n%s\n' "${c_dim}↑/↓ move · Enter select · 1–9 shortcut · b back · q quit${c_reset}"
}

menu_select() {
  local title="$1"
  local subtitle="$2"
  shift 2
  local options=("$@")
  local selected=0
  local key sequence index

  menu_navigation=active
  menu_choice=-1
  menu_tty_state=''
  menu_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  trap 'menu_navigation=quit' INT TERM

  while true; do
    render_menu "$title" "$subtitle" "$selected" "${options[@]}"
    key=''
    if ! IFS= read -r -s -n 1 key; then
      menu_navigation=quit
      break
    fi
    if [[ "$menu_navigation" == quit ]]; then
      break
    fi

    case "$key" in
      $'\033')
        sequence=''
        IFS= read -r -s -n 2 sequence || true
        case "$sequence" in
          '[A'|OA)
            if ((selected > 0)); then
              selected=$((selected - 1))
            else
              selected=$((${#options[@]} - 1))
            fi
            ;;
          '[B'|OB)
            if ((selected < ${#options[@]} - 1)); then
              selected=$((selected + 1))
            else
              selected=0
            fi
            ;;
        esac
        ;;
      $'\n'|$'\r')
        menu_choice=$selected
        menu_navigation=select
        break
        ;;
      [1-9])
        index=$((key - 1))
        if ((index < ${#options[@]})); then
          menu_choice=$index
          menu_navigation=select
          break
        fi
        ;;
      b|B)
        menu_navigation=back
        break
        ;;
      q|Q|$'\003'|$'\004')
        menu_navigation=quit
        break
        ;;
    esac
  done

  restore_menu_terminal
  trap - INT TERM
}

run_action() {
  local label="$1"
  shift
  clear_shell
  printf '%s\n' "${c_cyan}${c_bold}hackOS ${environment} · ${label}${c_reset}"
  printf '%s\n\n' "${c_dim}Compose project: ${project_name}${c_reset}"
  run_child "$@"
  pause_shell
}

report_child_failure() {
  local status="$1"
  if ((status == 130 || status == 143)); then
    printf '%s\n' "${c_dim:-}Log stream stopped; returning to the menu.${c_reset:-}" >&2
  else
    printf '%s\n' "${c_red:-}Command failed with exit status ${status}; returning to the menu.${c_reset:-}" >&2
  fi
}

run_child() {
  local status
  if "$0" "$environment" "$@"; then
    return 0
  else
    status=$?
  fi
  report_child_failure "$status"
  return 0
}

run_child_with_secret() {
  local secret="$1"
  shift
  local status
  if printf '%s\n' "$secret" | "$0" "$environment" "$@"; then
    return 0
  else
    status=$?
  fi
  report_child_failure "$status"
  return 0
}

run_action_with_secret() {
  local label="$1"
  local secret="$2"
  shift 2
  clear_shell
  printf '%s\n' "${c_cyan}${c_bold}hackOS ${environment} · ${label}${c_reset}"
  printf '%s\n\n' "${c_dim}Compose project: ${project_name}${c_reset}"
  run_child_with_secret "$secret" "$@"
  pause_shell
}

format_status_stream() {
  awk \
    -v reset="$c_reset" \
    -v bold="$c_bold" \
    -v cyan="$c_cyan" \
    -v green="$c_green" \
    -v yellow="$c_yellow" \
    -v red="$c_red" \
    '
      NR == 1 { printf "%s%s%s\n", cyan, bold $0, reset; next }
      {
        lower = tolower($0)
        colour = ""
        if (lower ~ /exited|dead|removing|failed/) colour = red
        else if (lower ~ /starting|restarting|created/) colour = yellow
        else if (lower ~ /running|up|healthy/) colour = green
        printf "%s%s%s\n", colour, $0, reset
      }
    '
}

format_log_stream() {
  local event_type="${1:-all}"
  local event_match="${2:-}"
  awk \
    -v filter="$event_type" \
    -v needle="$event_match" \
    -v reset="$c_reset" \
    -v dim="$c_dim" \
    -v red="$c_red" \
    -v yellow="$c_yellow" \
    -v cyan="$c_cyan" \
    -v blue="$c_blue" \
    -v magenta="$c_magenta" \
    -v green="$c_green" \
    '
      function service_colour(line) {
        if (line ~ /^api-[^[:space:]]+[[:space:]]+[|]/) return blue
        if (line ~ /^worker-[^[:space:]]+[[:space:]]+[|]/) return magenta
        if (line ~ /^web-[^[:space:]]+[[:space:]]+[|]/) return cyan
        if (line ~ /^postgres-[^[:space:]]+[[:space:]]+[|]/) return green
        if (line ~ /^valkey-[^[:space:]]+[[:space:]]+[|]/) return yellow
        if (line ~ /^minio(-init)?-[^[:space:]]+[[:space:]]+[|]/) return blue
        return ""
      }
      function selected_event(lower) {
        if (filter == "all") return 1
        if (filter == "error") return lower ~ /error|fatal|panic|exception|uncaught|failed|failure|out of memory|oom|"level"[[:space:]]*:[[:space:]]*(50|60)/
        if (filter == "warning") return lower ~ /warn|warning|deprecated|retry|reconnect/
        if (filter == "request") return lower ~ /incoming request|request completed|http|"method"[[:space:]]*:|statuscode/
        if (filter == "health") return lower ~ /healthz|readiness|liveness|health/
        if (filter == "match") return index(lower, tolower(needle)) > 0
        return 1
      }
      {
        line = $0
        lower = tolower(line)
        if (!selected_event(lower)) next
        colour = service_colour(line)
        if (lower ~ /error|fatal|panic|exception|uncaught|failed|failure|out of memory|oom|"level"[[:space:]]*:[[:space:]]*(50|60)/) colour = red
        else if (lower ~ /warn|warning|deprecated|retry|reconnect/) colour = yellow
        else if (lower ~ /healthz|readiness|liveness/) colour = dim
        else if (lower ~ /incoming request|request completed|http|"method"[[:space:]]*:|statuscode/) colour = cyan
        printf "%s%s%s\n", colour, line, reset
      }
    '
}

select_services() {
  local mode="$1"
  local title="Choose a service"
  local subtitle
  local candidates=()
  local choices=("All services")
  local service

  if [[ "$mode" == stop ]]; then
    subtitle="Stop selected runtime services · b returns to the main menu"
    candidates=("${runtime_services[@]}")
  else
    subtitle="View logs from one service or the whole project · b returns"
    candidates=("${all_services[@]}")
  fi
  for service in "${candidates[@]}"; do
    choices+=("$service")
  done

  selected_services=()
  if ! menu_select "$title" "$subtitle" "${choices[@]}"; then
    service_selection_navigation=quit
    return 0
  fi
  service_selection_navigation="$menu_navigation"
  [[ "$menu_navigation" == select ]] || return 0
  if ((menu_choice > 0)); then
    selected_services=("${candidates[$((menu_choice - 1))]}")
  fi
}

select_log_filter() {
  local choices=(
    "All events"
    "Errors and failures"
    "Warnings and retries"
    "HTTP request events"
    "Health checks"
    "Custom text search"
  )
  local custom_match

  log_event_type=all
  log_event_match=''
  if ! menu_select "Filter log events" "Choose a built-in category or search for text" "${choices[@]}"; then
    log_filter_navigation=quit
    return 0
  fi
  log_filter_navigation="$menu_navigation"
  [[ "$menu_navigation" == select ]] || return 0

  case "$menu_choice" in
    0) log_event_type=all ;;
    1) log_event_type=error ;;
    2) log_event_type=warning ;;
    3) log_event_type=request ;;
    4) log_event_type=health ;;
    5)
      while true; do
        read_shell_input "Text to match (b back, q quit): "
        case "$shell_navigation" in
          back)
            log_filter_navigation=back
            return 0
            ;;
          quit)
            log_filter_navigation=quit
            return 0
            ;;
        esac
        custom_match="$shell_input"
        if [[ -n "$custom_match" ]]; then
          log_event_type=match
          log_event_match="$custom_match"
          break
        fi
        printf '%s\n' "${c_yellow}Enter text to search for, or type b to go back.${c_reset}"
      done
      ;;
  esac
}

superadmin_count() {
  local listing
  if ! listing="$(run_api_script scripts/list-superadmins.mjs 2>/dev/null)"; then
    return 1
  fi
  if [[ "$listing" =~ ^([0-9]+)[[:space:]]+account ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    return 1
  fi
}

confirm_additional_superadmin() {
  local count
  local prompt_value

  superadmin_prompt_navigation=value
  allow_existing_superadmin=false
  if ! count="$(superadmin_count)"; then
    printf '%s\n' "${c_red}Could not check the current superadmin count; no change was made.${c_reset}"
    return 1
  fi
  if ((count == 0)); then
    return 0
  fi

  printf '%s\n' "${c_yellow}There are already ${count} active superadmin(s).${c_reset}"
  printf '%s\n' "${c_dim}Adding another requires an explicit ALLOW confirmation.${c_reset}"
  read_shell_input "Type ALLOW to continue (b back, q quit): "
  case "$shell_navigation" in
    back)
      superadmin_prompt_navigation=back
      return 10
      ;;
    quit)
      superadmin_prompt_navigation=quit
      return 11
      ;;
  esac
  prompt_value="$shell_input"
  if [[ "$prompt_value" == ALLOW ]]; then
    allow_existing_superadmin=true
    return 0
  fi
  printf '%s\n' "${c_dim}No change was made. Type ALLOW exactly when a second superadmin is intended.${c_reset}"
  return 1
}

superadmin_shell() {
  local choices=(
    "List current superadmins"
    "Set up a new account"
    "Grant superadmin to an existing account"
    "Revoke superadmin from an account"
  )
  local email name surname password
  local create_command=() grant_command=() revoke_command=()
  local confirmation_status

  while [[ "$shell_quit" != true ]]; do
    if ! menu_select "Superadmin management" "Audited account access · b returns to service operations" "${choices[@]}"; then
      return 0
    fi
    case "$menu_navigation" in
      back)
        return 0
        ;;
      quit)
        shell_quit=true
        return 0
        ;;
      select)
        case "$menu_choice" in
          0)
            run_action "superadmins" superadmin list
            ;;
          1)
            read_shell_input "New account email (b back, q quit): "
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            email="$shell_input"
            read_shell_input "First name (b back, q quit): "
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            name="$shell_input"
            read_shell_input "Surname (b back, q quit): "
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            surname="$shell_input"
            read_shell_input "Initial password (b back, q quit): " silent
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            password="$shell_input"
            if [[ -z "$email" || -z "$name" || -z "$surname" || -z "$password" ]]; then
              printf '%s\n' "${c_red}Email, name, surname, and password are required.${c_reset}"
              pause_shell
              continue
            fi
            create_command=(superadmin create --email "$email" --password-stdin --name "$name" --surname "$surname")
            if confirm_additional_superadmin; then
              confirmation_status=0
            else
              confirmation_status=$?
            fi
            case "$confirmation_status" in
              10) continue ;;
              11) shell_quit=true; return 0 ;;
              0)
                if [[ "$allow_existing_superadmin" == true ]]; then
                  create_command+=(--allow-existing-admin)
                fi
                ;;
              *) pause_shell; continue ;;
            esac
            run_action_with_secret "set up superadmin" "$password" "${create_command[@]}"
            create_command=()
            password=''
            ;;
          2)
            read_shell_input "Existing account email (b back, q quit): "
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            email="$shell_input"
            [[ -n "$email" ]] || {
              printf '%s\n' "${c_red}An email address is required.${c_reset}"
              pause_shell
              continue
            }
            grant_command=(superadmin grant --email "$email")
            if confirm_additional_superadmin; then
              confirmation_status=0
            else
              confirmation_status=$?
            fi
            case "$confirmation_status" in
              10) continue ;;
              11) shell_quit=true; return 0 ;;
              0)
                if [[ "$allow_existing_superadmin" == true ]]; then
                  grant_command+=(--allow-existing-admin)
                fi
                ;;
              *) pause_shell; continue ;;
            esac
            run_action "grant superadmin" "${grant_command[@]}"
            grant_command=()
            ;;
          3)
            read_shell_input "Superadmin email to revoke (b back, q quit): "
            [[ "$shell_navigation" == value ]] || {
              [[ "$shell_navigation" == quit ]] && shell_quit=true
              continue
            }
            email="$shell_input"
            [[ -n "$email" ]] || {
              printf '%s\n' "${c_red}An email address is required.${c_reset}"
              pause_shell
              continue
            }
            revoke_command=(superadmin revoke --email "$email")
            run_action "revoke superadmin" "${revoke_command[@]}"
            revoke_command=()
            ;;
        esac
        ;;
    esac
  done
}

interactive_shell() {
  [[ -t 0 && -t 1 ]] || die "the interactive shell requires a terminal"
  terminal_setup
  shell_quit=false
  local choices=(
    "Show service status"
    "View logs and event filters"
    "Start runtime"
    "Stop selected services"
    "Shut down all services"
    "Manage superadmins"
    "Help"
  )
  local log_command=() stop_command=() follow_logs service_label
  local confirmation

  while [[ "$shell_quit" != true ]]; do
    if ! menu_select "Service shell" "${project_name} · arrows navigate, number keys select" "${choices[@]}"; then
      return 0
    fi
    case "$menu_navigation" in
      back|quit)
        return 0
        ;;
      select)
        case "$menu_choice" in
          0)
            run_action "service status" status
            ;;
          1)
            select_services logs
            if [[ "$service_selection_navigation" == quit ]]; then
              return 0
            fi
            [[ "$service_selection_navigation" == select ]] || continue
            select_log_filter
            if [[ "$log_filter_navigation" == quit ]]; then
              return 0
            fi
            [[ "$log_filter_navigation" == select ]] || continue
            read_shell_input "Follow logs? [y/N] (b back, q quit): "
            if [[ "$shell_navigation" == quit ]]; then
              return 0
            fi
            [[ "$shell_navigation" == value ]] || continue
            log_command=(logs --tail "${HACKOS_LOG_TAIL:-200}" --event-type "$log_event_type")
            if [[ "$log_event_type" == match ]]; then
              log_command+=(--match "$log_event_match")
            fi
            if [[ "$shell_input" == [yY] ]]; then
              log_command+=(--follow)
            fi
            if ((${#selected_services[@]} == 0)); then
              service_label="all services"
            else
              service_label="${selected_services[*]}"
              log_command+=("${selected_services[@]}")
            fi
            run_action "logs · ${service_label} · ${log_event_type}" "${log_command[@]}"
            ;;
          2)
            run_action "start runtime" start
            ;;
          3)
            select_services stop
            if [[ "$service_selection_navigation" == quit ]]; then
              return 0
            fi
            [[ "$service_selection_navigation" == select ]] || continue
            stop_command=(stop)
            if ((${#selected_services[@]} > 0)); then
              stop_command+=("${selected_services[@]}")
            fi
            run_action "stop · ${selected_services[*]:-all runtime services}" "${stop_command[@]}"
            ;;
          4)
            read_shell_input "Type SHUTDOWN to stop all ${environment} services (b back, q quit): "
            [[ "$shell_navigation" == quit ]] && return 0
            [[ "$shell_navigation" == value ]] || continue
            confirmation="$shell_input"
            if [[ "$confirmation" == SHUTDOWN ]]; then
              run_action "shutdown" shutdown
            else
              printf '%s\n' "${c_dim}Shutdown cancelled; persistent data was not changed.${c_reset}"
              pause_shell
            fi
            ;;
          5)
            superadmin_shell
            ;;
          6)
            print_shell_help
            ;;
        esac
        ;;
    esac
  done
}

terminal_setup

case "$action" in
  status)
    validate_services "$@"
    status_args=(ps --all --format "$service_status_format")
    if (($# > 0)); then
      status_args+=("$@")
    fi
    if compose "${status_args[@]}" | format_status_stream; then
      :
    else
      status=$?
      exit "$status"
    fi
    ;;

  logs)
    follow=false
    tail_lines="${HACKOS_LOG_TAIL:-200}"
    event_type=all
    event_match=''
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
        --event-type|--filter)
          shift
          (($# > 0)) || die "--event-type requires a value"
          event_type="$1"
          ;;
        --event-type=*|--filter=*)
          event_type="${1#*=}"
          ;;
        --match)
          shift
          (($# > 0)) || die "--match requires text"
          event_type=match
          event_match="$1"
          ;;
        --match=*)
          event_type=match
          event_match="${1#*=}"
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
    case "$event_type" in
      all|error|warning|request|health) ;;
      match)
        [[ -n "$event_match" ]] || die "--match requires non-empty text"
        ;;
      *)
        die "unknown event type: $event_type (use all, error, warning, request, health, or --match TEXT)"
        ;;
    esac
    validate_services "${services[@]}"
    log_args=(logs --no-color --timestamps --tail "$tail_lines")
    if [[ "$follow" == true ]]; then
      log_args+=(--follow)
    fi
    log_args+=("${services[@]}")
    if compose "${log_args[@]}" | format_log_stream "$event_type" "$event_match"; then
      :
    else
      status=$?
      exit "$status"
    fi
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
