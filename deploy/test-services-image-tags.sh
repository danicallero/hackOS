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

echo 'services image-tag regression test: passed'
