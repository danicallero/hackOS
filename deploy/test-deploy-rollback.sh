#!/usr/bin/env bash
# Regression test (#1276): a release that fails to start must not leave the
# environment down. Runs deploy/incus-deploy.sh against a fake Docker.
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
# Minimal Docker/Compose double driven by files under $FAKE_ROOT.
set -Eeuo pipefail
r="$FAKE_ROOT"
if [[ "${1:-}" == compose && "${2:-}" == version ]]; then echo 'Docker Compose v2.test'; exit 0; fi
if [[ "${1:-}" == image && "${2:-}" == inspect ]]; then
  image="${*: -1}"
  printf '%s\n' "${image##*:sha-}"
  exit 0
fi
if [[ "${1:-}" == inspect ]]; then
  format="$3"; id="$4"; svc="${id#cid-}"
  case "$format" in
    *Config.Image*) [[ "$svc" =~ ^(postgres|valkey|minio)$ ]] && { echo "$svc:latest"; exit 0; }; printf 'ghcr.io/danicallero/hackos-%s:%s\n' "${svc/worker/api}" "$(cat "$r/running-$svc")" ;;
    *Health.Status*)
      [[ "$svc" =~ ^(postgres|valkey|minio)$ ]] && { echo healthy; exit 0; }
      if grep -qx "$(cat "$r/running-$svc")" "$r/bad-tags" 2>/dev/null; then echo unhealthy; else echo healthy; fi ;;
    *State.Status*) echo running ;;
  esac
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
  ps) svc="${*: -1}"; [[ -f "$r/running-$svc" ]] && echo "cid-$svc" || true ;;
  run) if [[ " $* " == *" migrate "* && -f "$r/migrate-fails" ]]; then echo 'migration failed' >&2; exit 1; fi ;;
  up)
    for svc in api worker web; do
      if [[ " $* " == *" $svc "* ]]; then
        case "$svc" in web) tag="$WEB_IMAGE_TAG" ;; *) tag="$API_IMAGE_TAG" ;; esac
        printf '%s' "$tag" >"$r/running-$svc"
      fi
    done ;;
esac
FAKE
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/bin/flock"
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/bin/mountpoint"
printf '#!/usr/bin/env bash\nexit 0\n' >"$root/check-env.sh"
chmod 700 "$root/bin/"* "$root/check-env.sh"

# run_deploy <environment> <scenario>; scenario: ok | api-unhealthy | migrate-fails
run_deploy() {
  local environment="$1" scenario="$2"
  export FAKE_ROOT="$root/fake" HACKOS_APP_DIR="$root/app"
  rm -rf "$FAKE_ROOT" "$HACKOS_APP_DIR"
  mkdir -p "$FAKE_ROOT" "$HACKOS_APP_DIR/data"
  touch "$HACKOS_APP_DIR/docker-compose.yml"
  printf 'HACKOS_DATA_DIR=%s\n' "$HACKOS_APP_DIR/data" >"$root/hackos.env"
  chmod 600 "$root/hackos.env"
  for svc in api worker web; do printf '%s' "$old" >"$FAKE_ROOT/running-$svc"; done
  for svc in postgres valkey minio; do printf '%s' "$old" >"$FAKE_ROOT/running-$svc"; done
  printf 'API_IMAGE_TAG=%s\nWEB_IMAGE_TAG=%s\n' "$old" "$old" >"$HACKOS_APP_DIR/.image-tags"
  case "$scenario" in
    api-unhealthy) printf '%s\n' "$new" >"$FAKE_ROOT/bad-tags" ;;
    migrate-fails) touch "$FAKE_ROOT/migrate-fails" ;;
  esac
  set +e
  PATH="$root/bin:$PATH" HACKOS_LOCK_HELD=true HACKOS_CONFIG_FILE="$root/hackos.env" \
    HACKOS_SECRETS_FILE="$root/none" HACKOS_CHECK_ENV_FILE="$root/check-env.sh" \
    HACKOS_BACKUP_FILE="$root/none" HACKOS_RELEASE_DIR="$root/releases" \
    bash "$deploy_script" "$environment" "$new" true true >"$root/out" 2>&1
  status=$?
  set -e
}

fail() { echo "FAIL: $1" >&2; cat "$root/out" >&2; exit 1; }
running() { cat "$FAKE_ROOT/running-$1"; }

run_deploy staging ok
[[ $status -eq 0 ]] || fail "healthy release should deploy"
[[ "$(running api)" == "$new" && "$(running web)" == "$new" ]] || fail "healthy release should be running"
grep -q "API_IMAGE_TAG=$new" "$HACKOS_APP_DIR/.image-tags" || fail "state file should record the new release"

run_deploy staging api-unhealthy
[[ $status -ne 0 ]] || fail "unhealthy release must fail the deployment"
[[ "$(running api)" == "$old" && "$(running worker)" == "$old" ]] || fail "API and worker must be rolled back to $old"
grep -q "API_IMAGE_TAG=$old" "$HACKOS_APP_DIR/.image-tags" || fail "state file must keep the previous release"
grep -q "ROLLBACK: API and worker are healthy on $old" "$root/out" || fail "rollback should be reported"
[[ ! -e "$HACKOS_APP_DIR/.release-policy" ]] || fail "staging must not write a release hold"

run_deploy staging migrate-fails
[[ $status -ne 0 ]] || fail "a failing migration must fail the deployment"
[[ "$(running api)" == "$old" ]] || fail "a failing migration must leave the running API untouched"
if grep -Eq "^up .*force-recreate api worker" "$FAKE_ROOT/calls"; then fail "API must not be recreated after a failed migration"; fi

run_deploy production api-unhealthy
[[ $status -ne 0 && "$(running api)" == "$old" ]] || fail "production must roll back too"
grep -q "^tag=$old$" "$HACKOS_APP_DIR/.release-policy" || fail "production must hold at the serving release"
grep -q "reason=failed-release:$new" "$HACKOS_APP_DIR/.release-policy" || fail "hold must name the failed release"

echo "deploy rollback regression: ok"
