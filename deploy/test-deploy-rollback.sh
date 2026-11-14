#!/usr/bin/env bash
# Regression test (#1276, #1327): a release that fails to start must not leave
# the environment down, and a healthy release replaces each application
# service without stopping the old replica first. Runs deploy/incus-deploy.sh
# against a fake Docker that models containers per service.
set -Eeuo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_script="$deploy_dir/incus-deploy.sh"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

old=sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
new=sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

mkdir -p "$root/bin"
cat >"$root/bin/docker" <<'FAKE'
#!/usr/bin/env bash
# Minimal Docker/Compose double. Each container is a file
# $FAKE_ROOT/containers/<id> holding "<service> <tag>"; the config hash of an
# application service is its image tag.
set -Eeuo pipefail
r="$FAKE_ROOT"
c="$r/containers"
mkdir -p "$c"
tag_for() {
  case "$1" in
    api|worker|migrate) printf '%s' "$API_IMAGE_TAG" ;;
    web) printf '%s' "$WEB_IMAGE_TAG" ;;
    *) printf 'static' ;;
  esac
}
ids_for() {
  local f
  for f in "$c"/*; do
    [[ -e "$f" ]] || continue
    [[ "$(cut -d' ' -f1 "$f")" == "$1" ]] && basename "$f"
  done
  return 0
}
create() {
  local n
  n="$(cat "$r/next-id" 2>/dev/null || echo 1)"
  printf '%s\n' "$((n + 1))" >"$r/next-id"
  printf '%s %s\n' "$1" "$(tag_for "$1")" >"$c/cid-$1-$n"
  echo "create $1 $(tag_for "$1")" >>"$r/calls"
}
if [[ "${1:-}" == compose && "${2:-}" == version ]]; then echo 'Docker Compose v2.test'; exit 0; fi
if [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  image="${*: -1}"
  printf '%s\n' "${image##*:sha-}"
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  format="$3"; id="$4"
  [[ -e "$c/$id" ]] || exit 1
  read -r svc tag <"$c/$id"
  case "$format" in
    *Config.Image*)
      [[ "$tag" == static ]] && { echo "$svc:latest"; exit 0; }
      printf 'ghcr.io/danicallero/hackos-%s:%s\n' "${svc/worker/api}" "$tag" ;;
    *Health.Status*)
      if grep -qx "$svc $tag" "$r/bad" 2>/dev/null; then echo unhealthy; else echo healthy; fi ;;
    *State.Status*) echo running ;;
    *config-hash*) echo "$tag" ;;
  esac
  exit 0
fi
if [[ "${1:-}" == stop || "${1:-}" == rm ]]; then
  action="$1"; shift
  for id in "$@"; do
    [[ "$id" == --* ]] && continue
    [[ -e "$c/$id" ]] || continue
    echo "$action $(cat "$c/$id")" >>"$r/calls"
    # stop keeps the record until rm, like Docker.
    [[ "$action" == rm ]] && rm -f "$c/$id"
  done
  exit 0
fi
[[ "${1:-}" == compose ]] || exit 0
shift
while [[ "${1:-}" == --* ]]; do
  case "$1" in --env-file|--file|--project-name) shift 2 ;; *) shift ;; esac
done
sub="${1:-}"; shift || true
printf '%s api=%s web=%s %s\n' "$sub" "${API_IMAGE_TAG:-}" "${WEB_IMAGE_TAG:-}" "$*" >>"$r/calls"
case "$sub" in
  ps) ids_for "${*: -1}" ;;
  config) if [[ " $* " == *" --hash "* ]]; then printf '%s %s\n' "${*: -1}" "$(tag_for "${*: -1}")"; fi ;;
  run) if [[ " $* " == *" migrate "* && -f "$r/migrate-fails" ]]; then echo 'migration failed' >&2; exit 1; fi ;;
  up)
    scale="" services=() force=false
    while (($#)); do
      case "$1" in
        --force-recreate) force=true ;;
        --scale) scale="$2"; shift ;;
        --wait-timeout|--pull) shift ;;
        --*) ;;
        *) services+=("$1") ;;
      esac
      shift
    done
    for svc in "${services[@]}"; do
      if [[ "$force" == true ]]; then
        for id in $(ids_for "$svc"); do rm -f "$c/$id"; done
        create "$svc"
      elif [[ -n "$scale" && "${scale%%=*}" == "$svc" ]]; then
        while (($(ids_for "$svc" | grep -c . || true) < ${scale#*=})); do create "$svc"; done
      elif [[ -z "$(ids_for "$svc")" ]]; then
        create "$svc"
      fi
    done ;;
esac
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/bin/flock"
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/bin/mountpoint"
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/check-env.sh"
chmod 700 "$root/bin/"* "$root/check-env.sh"

# run_deploy <environment> <topology> <scenario> [deploy_api] [deploy_web]
#   topology: proxy (rolling) | legacy (api/web still publish ports)
#   scenario: ok | api-unhealthy | migrate-fails
run_deploy() {
  local environment="$1" topology="$2" scenario="$3" svc
  export FAKE_ROOT="$root/fake" HACKOS_APP_DIR="$root/app"
  rm -rf "$FAKE_ROOT" "$HACKOS_APP_DIR"
  mkdir -p "$FAKE_ROOT/containers" "$HACKOS_APP_DIR/data"
  touch "$HACKOS_APP_DIR/docker-compose.yml"
  printf 'HACKOS_DATA_DIR=%s\n' "$HACKOS_APP_DIR/data" >"$root/hackos.env"
  chmod 600 "$root/hackos.env"
  for svc in api worker web; do printf '%s %s\n' "$svc" "$old" >"$FAKE_ROOT/containers/cid-$svc-old"; done
  for svc in postgres valkey minio; do printf '%s static\n' "$svc" >"$FAKE_ROOT/containers/cid-$svc"; done
  [[ "$topology" == proxy ]] && printf 'proxy static\n' >"$FAKE_ROOT/containers/cid-proxy"
  printf 'API_IMAGE_TAG=%s\nWEB_IMAGE_TAG=%s\n' "$old" "$old" >"$HACKOS_APP_DIR/.image-tags"
  case "$scenario" in
    api-unhealthy) printf 'api %s\n' "$new" >"$FAKE_ROOT/bad" ;;
    migrate-fails) touch "$FAKE_ROOT/migrate-fails" ;;
  esac
  set +e
  PATH="$root/bin:$PATH" HACKOS_LOCK_HELD=true HACKOS_CONFIG_FILE="$root/hackos.env" \
    HACKOS_SECRETS_FILE="$root/none" HACKOS_CHECK_ENV_FILE="$root/check-env.sh" \
    HACKOS_BACKUP_FILE="$root/none" HACKOS_RELEASE_DIR="$root/releases" \
    bash "$deploy_script" "$environment" "$new" "${4:-true}" "${5:-true}" >"$root/out" 2>&1
  status=$?
  set -e
}

fail() { echo "FAIL: $1" >&2; cat "$root/out" >&2; exit 1; }
# The tags of a service's containers, one per line.
running() {
  local f
  for f in "$FAKE_ROOT/containers"/*; do
    read -r svc tag <"$f"
    [[ "$svc" == "$1" ]] && echo "$tag"
  done
  return 0
}

# Zero-downtime path: each service gets a new replica before the old stops.
run_deploy staging proxy ok
[[ $status -eq 0 ]] || fail "healthy release should deploy"
for svc in api worker web; do
  [[ "$(running "$svc")" == "$new" ]] || fail "$svc should run exactly one $new replica"
done
grep -q "API_IMAGE_TAG=$new" "$HACKOS_APP_DIR/.image-tags" || fail "state file should record the new release"
if grep -q "force-recreate" "$FAKE_ROOT/calls"; then fail "a rolling deploy must not force-recreate"; fi
for svc in worker api web; do
  create_line="$(grep -n "^create $svc $new" "$FAKE_ROOT/calls" | cut -d: -f1)"
  stop_line="$(grep -n "^stop $svc $old" "$FAKE_ROOT/calls" | cut -d: -f1)"
  [[ -n "$create_line" && -n "$stop_line" && "$create_line" -lt "$stop_line" ]] ||
    fail "$svc: the new replica must start before the old one stops"
done
[[ "$(grep -n '^create worker' "$FAKE_ROOT/calls" | cut -d: -f1)" -lt "$(grep -n '^create api' "$FAKE_ROOT/calls" | cut -d: -f1)" ]] ||
  fail "the worker must roll before the API"

# A web-only release leaves an unchanged API and worker alone.
run_deploy staging proxy ok false true
[[ $status -eq 0 ]] || fail "web-only release should deploy"
[[ "$(running api)" == "$old" && "$(running web)" == "$new" ]] || fail "web-only release must keep the API"
grep -q "SKIP: api unchanged" "$root/out" || fail "an unchanged API should be skipped"

# A replica that never becomes healthy is discarded; the old one never stopped.
run_deploy staging proxy api-unhealthy
[[ $status -ne 0 ]] || fail "unhealthy release must fail the deployment"
[[ "$(running api)" == "$old" ]] || fail "only the previous API replica may remain"
if grep -q "^stop api $old" "$FAKE_ROOT/calls"; then fail "the serving API must not be stopped"; fi
[[ "$(running worker)" == "$old" ]] || fail "the already rolled worker must return to $old"
grep -q "ROLLBACK: rolling worker back to $old" "$root/out" || fail "worker rollback should be reported"
grep -q "API_IMAGE_TAG=$old" "$HACKOS_APP_DIR/.image-tags" || fail "state file must keep the previous release"
[[ ! -e "$HACKOS_APP_DIR/.release-policy" ]] || fail "staging must not write a release hold"

# First release with the proxy: one-time move of the published ports.
run_deploy staging legacy ok
[[ $status -eq 0 ]] || fail "first release with the proxy should deploy"
[[ "$(running api)" == "$new" && "$(running proxy)" == static ]] || fail "the proxy must start with the release"

run_deploy staging legacy api-unhealthy
[[ $status -ne 0 ]] || fail "unhealthy first release must fail"
[[ "$(running api)" == "$old" && "$(running worker)" == "$old" ]] || fail "API and worker must be rolled back to $old"
grep -q "ROLLBACK: API and worker are healthy on $old" "$root/out" || fail "rollback should be reported"
[[ "$(running proxy)" == static ]] || fail "the proxy must serve the restored release"

run_deploy staging proxy migrate-fails
[[ $status -ne 0 ]] || fail "a failing migration must fail the deployment"
[[ "$(running api)" == "$old" ]] || fail "a failing migration must leave the running API untouched"
if grep -q "^create api" "$FAKE_ROOT/calls"; then fail "no API replica may start after a failed migration"; fi

run_deploy production proxy api-unhealthy
[[ $status -ne 0 && "$(running api)" == "$old" ]] || fail "production must keep the serving release"
grep -q "^tag=$old$" "$HACKOS_APP_DIR/.release-policy" || fail "production must hold at the serving release"
grep -q "reason=failed-release:$new" "$HACKOS_APP_DIR/.release-policy" || fail "hold must name the failed release"

echo "deploy rollback regression: ok"
