#!/usr/bin/env bash
# Operate a hackOS Compose project without changing data.
set -Eeuo pipefail

print_help() {
  cat <<'EOF'
Usage:
  services.sh <environment> status [service ...]
  services.sh <environment> logs [--follow] [--tail N] [--event-type TYPE] [--match TEXT] [service ...]
  services.sh <environment> start [service ...]
  services.sh <environment> recreate [service ...]
  services.sh <environment> stop [service ...]
  services.sh <environment> shutdown
  services.sh <environment> release [service ...]
  services.sh <environment> available
  services.sh <environment> deploy <latest|sha-commit> [--api|--web|--both]
  services.sh <environment> shell
  services.sh <environment> superadmin <list|create|grant|revoke> [options]

Environments: staging production
Services: postgres valkey minio minio-init migrate api worker web

The default start/stop operations cover the long-running runtime. shutdown
stops the whole selected project and never removes volumes or bind data.
recreate force-recreates selected runtime services without building; release
prints the deployed image identity. available reads published GHCR package tags;
deploy is explicit and never accepts Docker :latest.

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
  local pause_tty_state

  printf '%s' "${c_dim}Press any key to return · ←/Esc also returns.${c_reset}"
  if [[ -t 0 ]]; then
    pause_tty_state="$(stty -g 2>/dev/null || true)"
    if [[ -n "$pause_tty_state" ]]; then
      stty -echo -icanon min 1 time 0
      trap 'navigation_action=quit' INT TERM
      read_navigation_key || true
      stty "$pause_tty_state" 2>/dev/null || true
      trap - INT TERM
      printf '\n'
      return 0
    fi
  fi
  read -r _ || true
  printf '\n'
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
  printf '%s\n' "  status       Show state, health, ports, and a short stopped-service reason."
  printf '%s\n' "  logs         Show colored logs; add --follow, --tail N, or --event-type."
  printf '%s\n' "               Event types: all, error, warning, request, health; combine filters in the shell."
  printf '%s\n' "               Use --match TEXT for a case-insensitive literal search."
  printf '%s\n' "  start        Start named services, or the runtime when no names are given."
  printf '%s\n' "  recreate     Recreate named services without building images."
  printf '%s\n' "  stop         Stop all services or named services."
  printf '%s\n' "  shutdown     Stop the whole project; persistent data is retained."
  printf '%s\n' "  release      Show the OCI revision and build time of a service image."
  printf '\n%s\n' "${c_bold}Image release commands${c_reset}"
  printf '%s\n' "  available    List published GHCR API/web image tags; no image is pulled."
  printf '%s\n' "  deploy latest [--api|--web|--both]"
  printf '%s\n' "                Pull and deploy the newest published image for the selected unit."
  printf '%s\n' "  deploy sha-<commit> [--api|--web|--both]"
  printf '%s\n' "                Validate, pull and deploy (or roll back to) that exact image."
  printf '%s\n' "  start/stop/recreate never query GHCR or pull an image."
  printf '\n%s\n' "${c_bold}Superadmin commands${c_reset}"
  printf '%s\n' "  superadmin list"
  printf '%s\n' "  superadmin create --email ... [--password-stdin] --name ... --surname ..."
  printf '%s\n' "  superadmin grant --email ... [--allow-existing-admin]"
  printf '%s\n' "  superadmin revoke --email ..."
  printf '\n%s\n' "${c_bold}Direct SSH examples${c_reset}"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} status"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} logs --event-type error api > api-errors.log"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} recreate api"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} release api"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} available"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} deploy latest --web"
  printf '%s\n' "  ssh user@host /opt/hackos/services.sh ${environment} deploy sha-<commit> --api"
  printf '\n%s\n' "${c_dim}↑/↓ move · Enter or → select · ←/Esc/b back · Space toggles service selections."
  printf '%s\n' "Tab changes log filters; q exits. Log views accept ←/Esc without an Enter prompt."
  printf '%s\n' "Superadmin operations call the audited server-side scripts in the API image."
  printf '%s\n' "Service actions do not build images; releases use immutable registry images."
  printf '%s\n' "Use the shell's local-build entry for the workstation-only rebuild command."
  printf '%s\n' "Environment values are not printed or edited in this menu; use sudoedit + check-env.sh."
  printf '%s\n' "Use e in a log view to print a command that saves remote logs locally."
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
  status|logs|start|recreate|stop|shutdown|release|available|deploy|shell|superadmin) ;;
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
service_status_format='{{.Service}}\t{{.State}}\t{{.Health}}\t{{.ExitCode}}\t{{.Ports}}'

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

read_navigation_key() {
  local key sequence

  navigation_action=value
  navigation_value=''
  key=''
  if ! IFS= read -r -s -n 1 key; then
    navigation_action=quit
    return 1
  fi
  # Bash 3's read -n treats a terminal newline as the delimiter and returns
  # it as an empty value when canonical mode is disabled (H22-H42, H46, H540, #544).
  if [[ -z "$key" ]]; then
    navigation_action=enter
    return 0
  fi

  case "$key" in
    $'\033')
      sequence=''
      IFS= read -r -s -n 2 sequence || true
      case "$sequence" in
        '[A'|OA) navigation_action=up ;;
        '[B'|OB) navigation_action=down ;;
        '[C'|OC) navigation_action=right ;;
        '[D'|OD) navigation_action=left ;;
        *) navigation_action=escape ;;
      esac
      ;;
    $'\n'|$'\r') navigation_action=enter ;;
    $'\t') navigation_action=tab ;;
    ' ') navigation_action=space ;;
    b|B) navigation_action=back ;;
    q|Q|$'\003'|$'\004') navigation_action=quit ;;
    *) navigation_value="$key" ;;
  esac
}

render_menu() {
  local title="$1"
  local subtitle="$2"
  local selected="$3"
  shift 3
  local options=("$@")
  local index

  if [[ "${preserve_next_menu:-false}" == true ]]; then
    preserve_next_menu=false
  else
    clear_shell
  fi
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
  printf '\n%s\n' "${c_dim}↑/↓ move · Enter/→ select · ←/Esc/b back · 1–9 shortcut · q quit${c_reset}"
}

menu_select() {
  local title="$1"
  local subtitle="$2"
  shift 2
  local options=("$@")
  local selected=0
  local index

  menu_navigation=active
  menu_choice=-1
  menu_tty_state=''
  menu_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  trap 'menu_navigation=quit' INT TERM

  while true; do
    render_menu "$title" "$subtitle" "$selected" "${options[@]}"
    if ! read_navigation_key; then
      menu_navigation=quit
      break
    fi
    if [[ "$menu_navigation" == quit ]]; then
      break
    fi

    case "$navigation_action" in
      up)
        if ((selected > 0)); then
          selected=$((selected - 1))
        else
          selected=$((${#options[@]} - 1))
        fi
        ;;
      down|tab)
        if ((selected < ${#options[@]} - 1)); then
          selected=$((selected + 1))
        else
          selected=0
        fi
        ;;
      right|enter)
        menu_choice=$selected
        menu_navigation=select
        break
        ;;
      left|escape|back)
        menu_navigation=back
        break
        ;;
      value)
        case "$navigation_value" in
          [1-9]) index=$((navigation_value - 1)) ;;
          *) continue ;;
        esac
        if ((index < ${#options[@]})); then
          menu_choice=$index
          menu_navigation=select
          break
        fi
        ;;
      quit)
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

run_action_without_pause() {
  local label="$1"
  shift
  clear_shell
  printf '%s\n' "${c_cyan}${c_bold}hackOS ${environment} · ${label}${c_reset}"
  printf '%s\n\n' "${c_dim}Compose project: ${project_name}${c_reset}"
  run_child "$@"
  preserve_next_menu=true
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
      BEGIN { FS = "\t"; OFS = "\t" }
      BEGIN {
        printf "%s%sSERVICE\tSTATE\tHEALTH\tEXIT CODE\tPORTS\tREASON%s\n", cyan, bold, reset
      }
      {
        service = $1
        state = $2
        health = $3
        exit_code = $4
        ports = $5
        lower = tolower(state " " health)
        reason = "-"
        if (tolower(state) ~ /exited/) {
          if (exit_code == "0" && service ~ /^(migrate|minio-init)$/) reason = "completed (one-shot)"
          else if (exit_code == "0") reason = "stopped cleanly"
          else if (exit_code ~ /^[0-9]+$/) reason = "failed (exit " exit_code ")"
          else reason = "stopped"
        } else if (tolower(state) ~ /created/) reason = "not started"
        else if (tolower(state) ~ /restarting/) reason = "restarting"
        else if (tolower(health) ~ /unhealthy/) reason = "healthcheck failing"
        else if (tolower(state) ~ /running|up/ && tolower(health) ~ /healthy/) reason = "ready"
        else if (tolower(state) ~ /running|up/) reason = "running"
        colour = ""
        if (lower ~ /exited|dead|removing|failed/) colour = red
        else if (lower ~ /starting|restarting|created/) colour = yellow
        else if (lower ~ /running|up|healthy/) colour = green
        printf "%s%s\t%s\t%s\t%s\t%s\t%s%s\n", colour, service, state, health, exit_code, ports, reason, reset
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
        matches_category = 0
        if (filter == "match") {
          matches_category = 1
        } else if (index("," filter ",", ",all,") > 0) {
          matches_category = 1
        } else {
          if (index("," filter ",", ",error,") > 0 && lower ~ /error|fatal|panic|exception|uncaught|failed|failure|out of memory|oom|"level"[[:space:]]*:[[:space:]]*(50|60)/) matches_category = 1
          if (index("," filter ",", ",warning,") > 0 && lower ~ /warn|warning|deprecated|retry|reconnect/) matches_category = 1
          if (index("," filter ",", ",request,") > 0 && lower ~ /incoming request|request completed|http|"method"[[:space:]]*:|statuscode/) matches_category = 1
          if (index("," filter ",", ",health,") > 0 && lower ~ /healthz|readiness|liveness|health/) matches_category = 1
        }
        if (!matches_category) return 0
        if (needle != "" && index(lower, tolower(needle)) == 0) return 0
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

render_multi_menu() {
  local title="$1"
  local subtitle="$2"
  local selected="$3"
  shift 3
  local options=("$@")
  local index marker

  clear_shell
  printf '%s\n' "${c_cyan}${c_bold}hackOS ${environment} · ${title}${c_reset}"
  printf '%s\n' "${c_dim}${subtitle}${c_reset}"
  printf '%s\n\n' "${c_cyan}────────────────────────────────────────────────────────────${c_reset}"
  for index in "${!options[@]}"; do
    marker=' '
    if [[ "${multi_selected_flags[index]:-false}" == true ]]; then
      marker='x'
    fi
    if ((index == selected)); then
      printf '  %s%s▸ [%s] %d  %s%s\n' "$c_cyan" "$c_bold" "$marker" "$((index + 1))" "${options[index]}" "$c_reset"
    else
      printf '    [%s] %d  %s\n' "$marker" "$((index + 1))" "${options[index]}"
    fi
  done
  printf '\n%s\n' "${c_dim}↑/↓ or Tab move · Space toggle · Enter/→ confirm · ←/Esc/b back · q quit${c_reset}"
}

multi_menu_select() {
  local title="$1"
  local subtitle="$2"
  shift 2
  local options=("$@")
  local selected=0
  local index all_selected has_selection

  multi_navigation=active
  multi_tty_state=''
  multi_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  trap 'multi_navigation=quit' INT TERM

  while true; do
    render_multi_menu "$title" "$subtitle" "$selected" "${options[@]}"
    if ! read_navigation_key; then
      multi_navigation=quit
      break
    fi
    if [[ "$multi_navigation" == quit ]]; then
      break
    fi

    case "$navigation_action" in
      up)
        if ((selected > 0)); then
          selected=$((selected - 1))
        else
          selected=$((${#options[@]} - 1))
        fi
        ;;
      down|tab)
        if ((selected < ${#options[@]} - 1)); then
          selected=$((selected + 1))
        else
          selected=0
        fi
        ;;
      right|enter)
        has_selection=false
        for index in "${!multi_selected_flags[@]}"; do
          if [[ "${multi_selected_flags[index]}" == true ]]; then
            has_selection=true
            break
          fi
        done
        if [[ "$has_selection" == true ]]; then
          multi_navigation=select
          break
        fi
        printf '%s\n' "${c_yellow}Select at least one service with Space, or choose All services.${c_reset}"
        sleep 1
        ;;
      left|escape|back)
        multi_navigation=back
        break
        ;;
      space)
        if ((selected == 0)); then
          if [[ "${multi_all_exclusive:-false}" == true ]]; then
            if [[ "${multi_selected_flags[0]:-false}" == true ]]; then
              multi_selected_flags[0]=false
            else
              for index in "${!multi_selected_flags[@]}"; do
                multi_selected_flags[index]=false
              done
              multi_selected_flags[0]=true
            fi
          else
            if [[ "${multi_selected_flags[0]:-false}" == true ]]; then
              for index in "${!multi_selected_flags[@]}"; do
                multi_selected_flags[index]=false
              done
            else
              for index in "${!multi_selected_flags[@]}"; do
                multi_selected_flags[index]=true
              done
            fi
          fi
        else
          if [[ "${multi_all_exclusive:-false}" == true && "${multi_selected_flags[0]:-false}" == true ]]; then
            for index in "${!multi_selected_flags[@]}"; do
              multi_selected_flags[index]=false
            done
            multi_selected_flags[selected]=true
          elif [[ "${multi_selected_flags[selected]:-false}" == true ]]; then
            multi_selected_flags[selected]=false
          else
            multi_selected_flags[selected]=true
          fi
          if [[ "${multi_all_exclusive:-false}" == true ]]; then
            multi_selected_flags[0]=false
          else
            all_selected=true
            for index in "${!multi_selected_flags[@]}"; do
              if ((index > 0)) && [[ "${multi_selected_flags[index]}" != true ]]; then
                all_selected=false
              fi
            done
            multi_selected_flags[0]="$all_selected"
          fi
        fi
        ;;
      value)
        case "$navigation_value" in
          [1-9])
            index=$((navigation_value - 1))
            if ((index < ${#options[@]})); then
              selected=$index
            fi
            ;;
        esac
        ;;
      quit)
        multi_navigation=quit
        break
        ;;
    esac
  done

  if [[ -n "${multi_tty_state:-}" ]]; then
    stty "$multi_tty_state" 2>/dev/null || true
    multi_tty_state=''
  fi
  trap - INT TERM
}

select_services_multi() {
  local mode="$1"
  local title subtitle scope_label default_all
  local candidates=()
  local choices=()
  local service index

  multi_all_exclusive=false
  case "$mode" in
    logs)
      title="Choose log services"
      subtitle="Space toggles services · Enter confirms · Tab moves · ←/Esc returns"
      scope_label="All services"
      candidates=("${all_services[@]}")
      default_all=true
      ;;
    start)
      title="Choose services to start"
      subtitle="Select stopped or healthy services to bring up · Space toggles"
      scope_label="All runtime services"
      candidates=("${runtime_services[@]}")
      default_all=false
      ;;
    stop)
      title="Choose services to stop"
      subtitle="Select runtime services to stop · Space toggles"
      scope_label="All runtime services"
      candidates=("${runtime_services[@]}")
      default_all=false
      ;;
    recreate|release)
      title="Choose services"
      subtitle="Select long-running services · Space toggles"
      scope_label="All runtime services"
      candidates=("${runtime_services[@]}")
      default_all=false
      ;;
    *)
      die "unknown service selection mode: $mode"
      ;;
  esac

  choices=("$scope_label")
  for service in "${candidates[@]}"; do
    choices+=("$service")
  done
  multi_selected_flags=()
  for index in "${!choices[@]}"; do
    multi_selected_flags[index]=false
  done
  if [[ "$default_all" == true ]]; then
    for index in "${!multi_selected_flags[@]}"; do
      multi_selected_flags[index]=true
    done
  fi

  if ! multi_menu_select "$title" "$subtitle" "${choices[@]}"; then
    service_selection_navigation=quit
    return 0
  fi
  service_selection_navigation="$multi_navigation"
  selected_services=()
  [[ "$multi_navigation" == select ]] || return 0
  for index in "${!candidates[@]}"; do
    if [[ "${multi_selected_flags[$((index + 1))]}" == true ]]; then
      selected_services+=("${candidates[index]}")
    fi
  done
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
  local custom_match index

  log_event_type=all
  log_event_match=''
  multi_all_exclusive=true
  multi_selected_flags=()
  for index in "${!choices[@]}"; do
    multi_selected_flags[index]=false
  done

  while true; do
    if ! multi_menu_select "Filter log events" "Space toggles · Enter confirms · All events overrides categories" "${choices[@]}"; then
      log_filter_navigation=quit
      return 0
    fi
    log_filter_navigation="$multi_navigation"
    [[ "$multi_navigation" == select ]] || return 0

    log_event_type=''
    log_event_match=''
    if [[ "${multi_selected_flags[0]:-false}" == true ]]; then
      log_event_type=all
    else
      for index in 1 2 3 4; do
        if [[ "${multi_selected_flags[index]:-false}" == true ]]; then
          case "$index" in
            1) custom_match=error ;;
            2) custom_match=warning ;;
            3) custom_match=request ;;
            4) custom_match=health ;;
          esac
          if [[ -n "$log_event_type" ]]; then
            log_event_type="${log_event_type},${custom_match}"
          else
            log_event_type="$custom_match"
          fi
        fi
      done
    fi

    if [[ "${multi_selected_flags[5]:-false}" == true ]]; then
      while true; do
        read_shell_input "Text to match (b back, q quit): "
        case "$shell_navigation" in
          back) break ;;
          quit)
            log_filter_navigation=quit
            return 0
            ;;
        esac
        custom_match="$shell_input"
        if [[ -n "$custom_match" ]]; then
          log_event_match="$custom_match"
          break
        fi
        printf '%s\n' "${c_yellow}Enter text to search for, or type b to go back.${c_reset}"
      done
      [[ -n "$log_event_match" ]] || continue
    fi

    [[ -n "$log_event_type" ]] || log_event_type=all
    return 0
  done
}

print_service_releases() {
  local service image revision created channel

  printf '%s\n' "${c_bold}Image releases${c_reset}"
  printf '%s\n' "${c_dim}Channel, revision and timestamp come from immutable OCI image metadata.${c_reset}"
  for service in "$@"; do
    image="$(compose ps --all --format '{{.Image}}' "$service" 2>/dev/null | sed -n '1p' || true)"
    if [[ -z "$image" ]]; then
      printf '%s\n' "${c_yellow}${service}: no container/image found${c_reset}"
      continue
    fi
    revision="$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' "$image" 2>/dev/null || true)"
    channel="$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.ref.name\" }}' "$image" 2>/dev/null || true)"
    created="$(docker image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.created\" }}' "$image" 2>/dev/null || true)"
    [[ -n "$created" && "$created" != '<no value>' ]] || created="$(docker image inspect --format '{{.Created}}' "$image" 2>/dev/null || true)"
    if [[ -z "$revision" || "$revision" == '<no value>' ]]; then
      printf '%s\n' "${c_yellow}${service}: ${image} · revision unavailable${c_reset}"
    else
      printf '%s\n' "${c_green}${service}: ${image}${c_reset}"
      printf '%s\n' "  revision: ${revision}"
      printf '%s\n' "  channel:  ${channel:-unknown}"
      printf '%s\n' "  built:    ${created:-unknown}"
      printf '%s\n' "  GitHub:   https://github.com/danicallero/hackOS/commit/${revision}"
    fi
  done
}

print_local_build_help() {
  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · local rebuild${c_reset}"
  printf '%s\n' "The deployment host consumes immutable registry images and has no source checkout."
  printf '%s\n' "From a hackOS checkout on your workstation, build the services locally:"
  printf '\n%s\n' "  docker build -f apps/api/Dockerfile -t hackos-api:local ."
  printf '%s\n' "  docker build -f apps/web/Dockerfile -t hackos-web:local ."
  printf '\n%s\n' "Use the repository's local Compose workflow for a full local runtime."
  printf '%s\n' "A local build does not change the deployed release or registry tags."
  pause_shell
}

quote_shell_value() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

infer_ssh_target() {
  local connection_host connection_user

  if [[ -n "${HACKOS_SSH_TARGET:-}" ]]; then
    printf '%s\n' "$HACKOS_SSH_TARGET"
    return 0
  fi

  connection_host="$(printf '%s\n' "${SSH_CONNECTION:-}" | awk '{ print $3 }')"
  connection_user="${HACKOS_SSH_USER:-${USER:-}}"
  if [[ -n "$connection_host" && -n "$connection_user" ]]; then
    printf '%s@%s\n' "$connection_user" "$connection_host"
  fi
}

infer_ssh_port() {
  local connection_port

  if [[ -n "${HACKOS_SSH_PORT:-}" ]]; then
    printf '%s\n' "$HACKOS_SSH_PORT"
    return 0
  fi

  connection_port="$(printf '%s\n' "${SSH_CONNECTION:-}" | awk '{ print $4 }')"
  if [[ "$connection_port" =~ ^[0-9]+$ && "$connection_port" != 22 ]]; then
    printf '%s\n' "$connection_port"
  fi
}

print_log_export_command() {
  local target output default_target ssh_port filter_args service_args service remote_path remote_command cleanup_command
  local key_tty_state

  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · export logs${c_reset}"
  printf '%s\n' "Run the printed block on your workstation; it creates, downloads, and cleans up a remote file."
  default_target="$(infer_ssh_target)"
  ssh_port="$(infer_ssh_port)"
  if [[ -n "$default_target" ]]; then
    read_shell_input "SSH target [${default_target}] (Enter accepts, b back, q quit): "
  else
    read_shell_input "SSH target (user@host, b back, q quit): "
  fi
  case "$shell_navigation" in
    back) return 0 ;;
    quit) log_view_navigation=quit; return 0 ;;
  esac
  target="$shell_input"
  [[ -n "$target" ]] || target="$default_target"
  if [[ -z "$target" ]]; then
    printf '%s\n' "${c_yellow}No SSH target was supplied; export cancelled.${c_reset}"
    pause_shell
    return 0
  fi
  read_shell_input "Local output file [hackos-${environment}-logs.log] (b back, q quit): "
  case "$shell_navigation" in
    back) return 0 ;;
    quit) log_view_navigation=quit; return 0 ;;
  esac
  output="$shell_input"
  [[ -n "$output" ]] || output="hackos-${environment}-logs.log"

  filter_args=(--event-type "$log_event_type")
  if [[ -n "$log_event_match" ]]; then
    filter_args+=(--match "$log_event_match")
  elif [[ "$log_event_type" == match ]]; then
    filter_args=(--match "$log_event_match")
  fi
  service_args=()
  for service in "${selected_services[@]}"; do
    service_args+=("$service")
  done
  if ((${#service_args[@]} == 0)); then
    service_args=("all services")
  fi
  remote_path="/tmp/hackos-${environment}-logs-$(date +%Y%m%d-%H%M%S)-$$.log"
  remote_command="/opt/hackos/services.sh $(quote_shell_value "$environment") logs --tail $(quote_shell_value "${HACKOS_LOG_TAIL:-200}")"
  for service in "${filter_args[@]}"; do
    remote_command="$remote_command $(quote_shell_value "$service")"
  done
  for service in "${service_args[@]}"; do
    remote_command="$remote_command $(quote_shell_value "$service")"
  done
  remote_command="$remote_command > $(quote_shell_value "$remote_path")"
  cleanup_command="rm -f $(quote_shell_value "$remote_path")"
  printf '\n%s\n' "${c_bold}Copy this to your workstation:${c_reset}"
  printf 'ssh -T'
  if [[ -n "$ssh_port" ]]; then
    printf ' -p %s' "$(quote_shell_value "$ssh_port")"
  fi
  printf ' %s %s &&\n' \
    "$(quote_shell_value "$target")" \
    "$(quote_shell_value "$remote_command")"
  printf 'scp'
  if [[ -n "$ssh_port" ]]; then
    printf ' -P %s' "$(quote_shell_value "$ssh_port")"
  fi
  printf ' %s %s &&\n' \
    "$(quote_shell_value "${target}:${remote_path}")" \
    "$(quote_shell_value "$output")"
  printf 'ssh -T'
  if [[ -n "$ssh_port" ]]; then
    printf ' -p %s' "$(quote_shell_value "$ssh_port")"
  fi
  printf ' %s %s\n' \
    "$(quote_shell_value "$target")" \
    "$(quote_shell_value "$cleanup_command")"
  printf '%s\n' "${c_dim}The remote temporary file is retained if ssh or scp fails, so it can be retried.${c_reset}"
  printf '\n%s\n' "${c_dim}Press any key to return. ←/Esc also returns.${c_reset}"
  key_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  trap 'navigation_action=quit' INT TERM
  if ! read_navigation_key; then
    log_view_navigation=quit
  elif [[ "$navigation_action" == quit ]]; then
    log_view_navigation=quit
  fi
  stty "$key_tty_state" 2>/dev/null || true
  trap - INT TERM
}

build_log_args() {
  log_args=(logs --no-color --timestamps --tail "${HACKOS_LOG_TAIL:-200}")
  log_args+=("${selected_services[@]}")
}

log_view_key_loop() {
  local key_tty_state

  key_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  trap 'log_view_navigation=quit' INT TERM
  if read_navigation_key; then
    case "$navigation_action" in
      value)
        case "$navigation_value" in
          r|R) log_view_navigation=refresh ;;
          f|F) log_view_navigation=follow ;;
          e|E) log_view_navigation=export ;;
          s|S) log_view_navigation=services ;;
          *) log_view_navigation=refresh ;;
        esac
        ;;
      enter|right) log_view_navigation=refresh ;;
      tab) log_view_navigation=filter ;;
      left|escape|back) log_view_navigation=back ;;
      quit) log_view_navigation=quit ;;
      *) log_view_navigation=refresh ;;
    esac
  else
    log_view_navigation=quit
  fi
  stty "$key_tty_state" 2>/dev/null || true
  trap - INT TERM
}

follow_log_view() {
  local stream_pid key_tty_state
  local follow_args=()

  build_log_args
  follow_args=("${log_args[@]}" --follow)
  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · live logs${c_reset}"
  printf '%s\n' "${c_dim}Following ${selected_services[*]} · ${log_event_type}${c_reset}"
  printf '%s\n\n' "${c_dim}←/Esc back · Tab filters · s services · e export · Ctrl-C stops following${c_reset}"
  (compose "${follow_args[@]}" | format_log_stream "$log_event_type" "$log_event_match") </dev/null &
  stream_pid=$!
  key_tty_state="$(stty -g)" || return 1
  stty -echo -icanon min 1 time 0
  log_view_navigation=follow
  trap 'log_view_navigation=quit' INT TERM
  while true; do
    if ! read_navigation_key; then
      log_view_navigation=quit
      break
    fi
    case "$navigation_action" in
      left|escape|back) log_view_navigation=back; break ;;
      tab) log_view_navigation=filter; break ;;
      quit) log_view_navigation=quit; break ;;
      value)
        case "$navigation_value" in
          s|S) log_view_navigation=services; break ;;
          e|E) log_view_navigation=export; break ;;
          *) : ;;
        esac
        ;;
    esac
  done
  kill "$stream_pid" 2>/dev/null || true
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "$stream_pid" 2>/dev/null || true
  fi
  wait "$stream_pid" 2>/dev/null || true
  stty "$key_tty_state" 2>/dev/null || true
  trap - INT TERM
}

show_log_view() {
  while true; do
    build_log_args
    clear_shell
    printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · logs${c_reset}"
    printf '%s\n' "${c_dim}${selected_services[*]} · ${log_event_type}${log_event_match:+ · ${log_event_match}}${c_reset}"
    printf '%s\n\n' "${c_cyan}────────────────────────────────────────────────────────────${c_reset}"
    if compose "${log_args[@]}" | format_log_stream "$log_event_type" "$log_event_match"; then
      :
    else
      printf '%s\n' "${c_red}Could not read the selected logs.${c_reset}"
    fi
    printf '\n%s\n' "${c_dim}r/Enter refresh · f follow · Tab filters · s services · e export · ←/Esc back · q quit${c_reset}"
    if ! log_view_key_loop; then
      log_view_navigation=quit
    fi
    case "$log_view_navigation" in
      refresh) ;;
      follow)
        follow_log_view
        ;;
      filter|services|export|back|quit)
        if [[ "$log_view_navigation" == export ]]; then
          print_log_export_command
          [[ "$log_view_navigation" == quit ]] && return 0
          log_view_navigation=refresh
        else
          return 0
        fi
        ;;
    esac
    [[ "$log_view_navigation" == quit ]] && return 0
  done
}

logs_shell() {
  while true; do
    select_services_multi logs
    case "$service_selection_navigation" in
      quit) shell_quit=true; return 0 ;;
      back) return 0 ;;
    esac
    while true; do
      select_log_filter
      case "$log_filter_navigation" in
        quit) shell_quit=true; return 0 ;;
        back) break ;;
      esac
      show_log_view
      case "$log_view_navigation" in
        quit) shell_quit=true; return 0 ;;
        services) break ;;
        filter) continue ;;
        back) return 0 ;;
      esac
    done
  done
}

recreate_selected_services() {
  local confirmation recreate_command=()

  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}hackOS ${environment} · recreate services${c_reset}"
  printf '%s\n' "${c_dim}The selected containers will be recreated with their current immutable image tags.${c_reset}"
  print_service_releases "${selected_services[@]}"
  printf '\n%s\n' "${c_yellow}This restarts: ${selected_services[*]}.${c_reset}"
  read_shell_input "Type RECREATE to continue (b back, q quit): "
  case "$shell_navigation" in
    back) return 0 ;;
    quit) shell_quit=true; return 0 ;;
  esac
  confirmation="$shell_input"
  if [[ "$confirmation" != RECREATE ]]; then
    printf '%s\n' "${c_dim}Recreation cancelled; no container was changed.${c_reset}"
    pause_shell
    return 0
  fi
  recreate_command=(recreate)
  recreate_command+=("${selected_services[@]}")
  printf '\n'
  run_child "${recreate_command[@]}"
  pause_shell
}

start_runtime_shell() {
  local choices=(
    "Start selected runtime services"
    "Recreate selected runtime services"
    "Show image releases"
    "Local rebuild instructions"
  )
  local start_command=() release_command=()

  while [[ "$shell_quit" != true ]]; do
    if ! menu_select "Start runtime" "Select a focused action · ←/Esc returns" "${choices[@]}"; then
      shell_quit=true
      return 0
    fi
    case "$menu_navigation" in
      back) return 0 ;;
      quit) shell_quit=true; return 0 ;;
      select)
        case "$menu_choice" in
          0)
            select_services_multi start
            case "$service_selection_navigation" in
              quit) shell_quit=true; return 0 ;;
              select)
                start_command=(start "${selected_services[@]}")
                run_action "start · ${selected_services[*]}" "${start_command[@]}"
                ;;
            esac
            ;;
          1)
            select_services_multi recreate
            case "$service_selection_navigation" in
              quit) shell_quit=true; return 0 ;;
              select) recreate_selected_services ;;
            esac
            ;;
          2)
            select_services_multi release
            case "$service_selection_navigation" in
              quit) shell_quit=true; return 0 ;;
              select)
                release_command=(release "${selected_services[@]}")
                run_action "image releases · ${selected_services[*]}" "${release_command[@]}"
                ;;
            esac
            ;;
          3)
            print_local_build_help
            ;;
        esac
        ;;
    esac
  done
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
            run_action_without_pause "superadmins" superadmin list
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

github_repository="${HACKOS_GITHUB_REPOSITORY:-danicallero/hackOS}"
github_owner="${github_repository%%/*}"

require_registry_tools() {
  command -v curl >/dev/null 2>&1 || die "registry operations require curl"
  command -v python3 >/dev/null 2>&1 || die "registry operations require python3"
}

ghcr_tags() {
  local package="$1" token
  require_registry_tools
  token="$(
    curl --fail --silent --show-error --get 'https://ghcr.io/token' \
      --data-urlencode 'service=ghcr.io' \
      --data-urlencode "scope=repository:${github_owner}/${package}:pull" |
      python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])'
  )" || die "could not obtain a read-only GHCR token for $package"
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $token" \
    "https://ghcr.io/v2/${github_owner}/${package}/tags/list?n=1000" |
    python3 -c 'import json, sys; print("\n".join(json.load(sys.stdin).get("tags", [])))' ||
    die "could not list GHCR tags for $package"
}

github_api() {
  require_registry_tools
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${github_repository}/$1"
}

is_release_tag() {
  [[ "$1" =~ ^(staging-|main-)?sha-[0-9a-f]{40}$ ]]
}

published_releases() {
  local tag channel
  local -A api_tags=() web_tags=() all_tags=()

  while IFS= read -r tag; do
    is_release_tag "$tag" || continue
    api_tags["$tag"]=true
    all_tags["$tag"]=true
  done < <(ghcr_tags hackos-api)
  while IFS= read -r tag; do
    is_release_tag "$tag" || continue
    web_tags["$tag"]=true
    all_tags["$tag"]=true
  done < <(ghcr_tags hackos-web)

  printf '%-12s %-52s %-5s %-5s\n' 'CHANNEL' 'TAG' 'API' 'WEB'
  for tag in "${!all_tags[@]}"; do
    case "$tag" in
      staging-sha-*) channel=staging ;;
      main-sha-*) channel=main ;;
      *) channel=legacy ;;
    esac
    printf '%-12s %-52s %-5s %-5s\n' \
      "$channel" "$tag" \
      "${api_tags[$tag]:-no}" "${web_tags[$tag]:-no}"
  done | sort -r
}

latest_staging_tag() {
  local api_changed="$1" web_changed="$2" commit tag
  while IFS= read -r commit; do
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || continue
    tag="sha-$commit"
    if [[ "$api_changed" == true ]] && ! published_for_unit hackos-api "$tag"; then
      continue
    fi
    if [[ "$web_changed" == true ]] && ! published_for_unit hackos-web "$tag"; then
      continue
    fi
    printf '%s\n' "$tag"
    return 0
  done < <(github_api 'commits?sha=staging&per_page=100' | python3 -c 'import json, sys; print("\n".join(item["sha"] for item in json.load(sys.stdin)))')
  die "could not find a published staging image set for the selected units"
}

resolve_release_tag() {
  local requested="$1" api_changed="$2" web_changed="$3" commit
  if [[ "$requested" != latest ]]; then
    [[ "$requested" =~ ^sha-[0-9a-f]{40}$ ]] || die "release must be latest or sha-<40 lowercase hex characters>"
    printf '%s\n' "$requested"
    return 0
  fi
  if [[ "$environment" == production ]]; then
    commit="$(github_api releases/latest | python3 -c 'import json, sys; print(json.load(sys.stdin)["target_commitish"])')" ||
      die "could not resolve the latest production GitHub Release"
  else
    latest_staging_tag "$api_changed" "$web_changed"
    return 0
  fi
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "could not resolve the latest published $environment release"
  printf 'sha-%s\n' "$commit"
}

published_for_unit() {
  local package="$1" tag="$2"
  ghcr_tags "$package" | grep --fixed-strings --line-regexp --quiet "$tag"
}

validate_published_release() {
  local tag="$1" api_changed="$2" web_changed="$3"
  if [[ "$api_changed" == true ]] && ! published_for_unit hackos-api "$tag"; then
    die "GHCR does not publish API image $tag"
  fi
  if [[ "$web_changed" == true ]] && ! published_for_unit hackos-web "$tag"; then
    die "GHCR does not publish web image $tag"
  fi
}

deploy_release() {
  local requested="$1" unit="both" tag api_changed web_changed
  shift
  while (($#)); do
    case "$1" in
      --api) unit=api ;;
      --web) unit=web ;;
      --both) unit=both ;;
      *) die "unknown deploy option: $1" ;;
    esac
    shift
  done
  api_changed=false; web_changed=false
  case "$unit" in
    api) api_changed=true ;;
    web) web_changed=true ;;
    both) api_changed=true; web_changed=true ;;
  esac
  tag="$(resolve_release_tag "$requested" "$api_changed" "$web_changed")"
  validate_published_release "$tag" "$api_changed" "$web_changed"
  printf 'Environment: %s\nAction: deploy\nAPI/worker: %s\nWeb: %s\n' "$environment" "$tag ($api_changed)" "$tag ($web_changed)"
  if [[ "$environment" == production ]]; then
    printf '%s\n' "Production is protected; run: gh workflow run deploy-incus.yml --repo $github_repository -f tag=$tag -f api_changed=$api_changed -f web_changed=$web_changed"
    return 0
  fi
  lock_mutation
  "$app_dir/deploy.sh" staging "$tag" "$api_changed" "$web_changed"
}

deploy_target_shell() {
  local requested="$1" tag option api_changed web_changed
  local choices=("API + worker" "Web" "API + worker and web")
  if ! menu_select "Choose deployment target" "Only the selected unit is pulled and recreated" "${choices[@]}"; then return 0; fi
  case "$menu_choice" in
    0) option=--api; api_changed=true; web_changed=false ;;
    1) option=--web; api_changed=false; web_changed=true ;;
    2) option=--both; api_changed=true; web_changed=true ;;
  esac
  tag="$(resolve_release_tag "$requested" "$api_changed" "$web_changed")"
  validate_published_release "$tag" "$api_changed" "$web_changed"
  clear_shell
  printf '%s\n\n' "${c_cyan}${c_bold}Confirm deployment${c_reset}"
  printf 'Environment: %s\nRelease:     %s\nAPI/worker:  %s\nWeb:         %s\n\n' \
    "$environment" "$tag" "$api_changed" "$web_changed"
  if [[ "$environment" == production ]]; then
    printf '%s\n' "Production opens the protected GitHub workflow; it does not deploy directly from this shell."
  else
    printf '%s\n' "This pulls the selected immutable image and recreates only the selected services."
  fi
  read_shell_input "Type DEPLOY to continue (b back, q quit): "
  [[ "$shell_navigation" == value ]] || return 0
  if [[ "$shell_input" == DEPLOY ]]; then
    run_action "deploy $tag" deploy "$tag" "$option"
  else
    printf '%s\n' "${c_dim}Deployment cancelled; no image was pulled.${c_reset}"
    pause_shell
  fi
}

release_shell() {
  local choices=("Inspect deployed images" "Browse published images" "Deploy latest published image" "Deploy a selected SHA")
  if ! menu_select "Images and releases" "Inspection is local · deployments are explicit" "${choices[@]}"; then return 0; fi
  case "$menu_choice" in
    0) run_action "deployed images" release ;;
    1) run_action "published images" available ;;
    2) deploy_target_shell latest ;;
    3)
      read_shell_input "Release tag (sha-<40 hex>, b back, q quit): "
      [[ "$shell_navigation" == value ]] || return 0
      deploy_target_shell "$shell_input"
      ;;
  esac
}

service_operations_shell() {
  local choices=("Start installed services" "Stop services" "Recreate installed services" "Stop all services")
  local stop_command=()
  local confirmation
  if ! menu_select "Operate installed services" "These actions never query GHCR or pull images" "${choices[@]}"; then return 0; fi
  case "$menu_choice" in
    0) start_runtime_shell ;;
    1)
      select_services_multi stop
      [[ "$service_selection_navigation" == select ]] || return 0
      stop_command=(stop "${selected_services[@]}")
      run_action "stop · ${selected_services[*]}" "${stop_command[@]}"
      ;;
    2)
      select_services_multi recreate
      [[ "$service_selection_navigation" == select ]] || return 0
      run_action "recreate · ${selected_services[*]}" recreate "${selected_services[@]}"
      ;;
    3)
      read_shell_input "Type STOP to stop all ${environment} services (b back, q quit): "
      [[ "$shell_navigation" == value ]] || return 0
      confirmation="$shell_input"
      if [[ "$confirmation" == STOP ]]; then
        run_action "stop all services" shutdown
      else
        printf '%s\n' "${c_dim}Stop cancelled; persistent data was not changed.${c_reset}"
        pause_shell
      fi
      ;;
  esac
}

interactive_shell() {
  [[ -t 0 && -t 1 ]] || die "the interactive shell requires a terminal"
  terminal_setup
  shell_quit=false
  local choices=(
    "Overview"
    "Operate installed services"
    "View logs"
    "Images and releases"
    "Manage superadmins"
    "Help"
  )

  while [[ "$shell_quit" != true ]]; do
    if ! menu_select "Operator console" "${project_name} · choose a task" "${choices[@]}"; then
      return 0
    fi
    case "$menu_navigation" in
      back|quit)
        return 0
        ;;
      select)
        case "$menu_choice" in
          0)
            run_action "overview" status
            ;;
          1)
            service_operations_shell
            ;;
          2)
            logs_shell
            ;;
          3)
            release_shell
            ;;
          4)
            superadmin_shell
            ;;
          5)
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
          event_match="$1"
          [[ "$event_type" != all ]] || event_type=match
          ;;
        --match=*)
          event_match="${1#*=}"
          [[ "$event_type" != all ]] || event_type=match
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
        [[ "$event_type" =~ ^(error|warning|request|health)(,(error|warning|request|health))*$ ]] || \
          die "unknown event type: $event_type (use all, error, warning, request, health, comma-separated filters, or --match TEXT)"
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

  recreate)
    validate_services "$@"
    lock_mutation
    recreate_services=("${runtime_services[@]}")
    if (($# > 0)); then
      recreate_services=("$@")
    fi
    compose up --detach --no-build --force-recreate --wait --wait-timeout 120 "${recreate_services[@]}"
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

  release)
    release_services=("${runtime_services[@]}")
    if (($# > 0)); then
      validate_services "$@"
      release_services=("$@")
    fi
    print_service_releases "${release_services[@]}"
    ;;

  available)
    (($# == 0)) || usage
    published_releases
    ;;

  deploy)
    (($# >= 1)) || usage
    deploy_release "$@"
    ;;

  superadmin)
    run_superadmin "$@"
    ;;

  shell)
    (($# == 0)) || usage 2
    interactive_shell
    ;;
esac
