#!/usr/bin/env bash
# Regression test: operator lifecycle actions must retain partial-release tags.
set -Eeuo pipefail

deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
services_script="$deploy_dir/scripts/services.sh"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

mkdir -p "$test_dir/bin" "$test_dir/app"
touch "$test_dir/docker-compose.yml"
printf '%s\n' 'IMAGE_TAG=sha-1111111111111111111111111111111111111111' >"$test_dir/hackos.env"
chmod 600 "$test_dir/hackos.env"
cat >"$test_dir/app/.image-tags" <<'EOF'
API_IMAGE_TAG=sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
WEB_IMAGE_TAG=sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
EOF
cat >"$test_dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == compose && "${2:-}" == version ]]; then
  echo 'Docker Compose version v2.test'
  exit 0
fi

printf '%s %s\n' "${API_IMAGE_TAG:-}" "${WEB_IMAGE_TAG:-}" >>"$HACKOS_TEST_DOCKER_LOG"
EOF
chmod 700 "$test_dir/bin/docker"
cat >"$test_dir/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 700 "$test_dir/bin/flock"
cat >"$test_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

case "$*" in
  *ghcr.io/token*) printf '%s\n' '{"token":"test"}' ;;
  *hackos-api/tags/list*|*hackos-web/tags/list*)
    printf '%s\n' '{"tags":["sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]}'
    ;;
  *)
    echo "unexpected curl request: $*" >&2
    exit 1
    ;;
esac
EOF
chmod 700 "$test_dir/bin/curl"
cat >"$test_dir/app/deploy.sh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s %s\n' "${HACKOS_LOCK_HELD:-}" "$*" >>"$HACKOS_TEST_DEPLOY_LOG"
EOF
chmod 700 "$test_dir/app/deploy.sh"

env -u API_IMAGE_TAG -u WEB_IMAGE_TAG \
  PATH="$test_dir/bin:$PATH" \
  HACKOS_APP_DIR="$test_dir/app" \
  HACKOS_COMPOSE_FILE="$test_dir/docker-compose.yml" \
  HACKOS_CONFIG_FILE="$test_dir/hackos.env" \
  HACKOS_TEST_DOCKER_LOG="$test_dir/docker.log" \
  bash "$services_script" staging status >/dev/null

expected='sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
grep -Fxq "$expected" "$test_dir/docker.log" || {
  echo 'services.sh did not preserve the deployed API/web image tags.' >&2
  exit 1
}

# The interactive "latest" flow resolves to sha-<commit>, then reinvokes this
# command with that exact tag. Verify that the exact immutable form is accepted.
env -u API_IMAGE_TAG -u WEB_IMAGE_TAG \
  PATH="$test_dir/bin:$PATH" \
  HACKOS_APP_DIR="$test_dir/app" \
  HACKOS_COMPOSE_FILE="$test_dir/docker-compose.yml" \
  HACKOS_CONFIG_FILE="$test_dir/hackos.env" \
  HACKOS_TEST_DOCKER_LOG="$test_dir/docker.log" \
  HACKOS_TEST_DEPLOY_LOG="$test_dir/deploy.log" \
  bash "$services_script" staging deploy sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --both >/dev/null

grep -Fxq 'true staging sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa true true' "$test_dir/deploy.log" || {
  echo 'services.sh did not pass its deployment lock to deploy.sh.' >&2
  exit 1
}

echo 'services image-tag regression test: passed'
