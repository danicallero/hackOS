#!/usr/bin/env bash
# Run on Linux with Docker and an already-built API image. Isolated fake apps,
# real Docker/Compose, gateway binary, socket requests and deployment script.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_image="${1:-hackos-rollout-api:verify}"
test_dir="$(mktemp -d)"
project_name=hackos-staging
test_host="${HACKOS_TEST_HOST:-127.0.0.1}"
[[ -z "$(docker ps -aq --filter label=com.docker.compose.project=hackos-staging)" ]] || { echo 'Refusing to share the staging Compose project with existing containers' >&2; exit 1; }
one="$(printf 'rollout-one-%s' "$test_dir" | sha1sum | cut -d' ' -f1)"
bad="$(printf 'rollout-bad-%s' "$test_dir" | sha1sum | cut -d' ' -f1)"
two="$(printf 'rollout-two-%s' "$test_dir" | sha1sum | cut -d' ' -f1)"
cleanup() {
  docker ps -aq --filter label=com.docker.compose.project=hackos-staging | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network rm hackos-staging_egress hackos-staging_edge hackos-staging_private hackos-staging_default >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT
mkdir -p "$test_dir/build"
cp "$root/deploy/rollout/fixture/server.mjs" "$test_dir/build/server.mjs"
cat > "$test_dir/build/Dockerfile" <<EOF_DOCKER
FROM $base_image
USER root
COPY server.mjs /app/dist/server.js
COPY server.mjs /app/dist/worker.js
RUN printf 'process.exit(0)\n' > /app/dist/migrate.js && mkdir -p /repo/apps/web/.next/static && printf 'immutable old chunk\n' > /repo/apps/web/.next/static/old-hash.js
USER node
EOF_DOCKER
docker build -q -t "ghcr.io/danicallero/hackos-api:sha-$one" "$test_dir/build" >/dev/null
docker tag "ghcr.io/danicallero/hackos-api:sha-$one" "ghcr.io/danicallero/hackos-web:sha-$one"
docker tag "ghcr.io/danicallero/hackos-api:sha-$one" "ghcr.io/danicallero/hackos-api:sha-$two"
docker tag "ghcr.io/danicallero/hackos-api:sha-$one" "ghcr.io/danicallero/hackos-web:sha-$two"
cat > "$test_dir/docker-compose.yml" <<'EOF_COMPOSE'
services:
  api:
    image: ghcr.io/danicallero/hackos-api:${API_IMAGE_TAG}
    pull_policy: never
    environment: {ROLE: api, RELEASE: "${API_IMAGE_TAG}"}
    networks: [egress]
    healthcheck: {test: [CMD-SHELL, "wget -qO- http://127.0.0.1:3000/healthz"], interval: 1s, timeout: 1s, retries: 10}
  web:
    image: ghcr.io/danicallero/hackos-web:${WEB_IMAGE_TAG}
    pull_policy: never
    entrypoint: [node, dist/server.js]
    environment: {ROLE: web, RELEASE: "${WEB_IMAGE_TAG}"}
    networks: [egress]
    healthcheck: {test: [CMD-SHELL, "wget -qO- http://127.0.0.1:3001/"], interval: 1s, timeout: 1s, retries: 10}
  worker:
    image: ghcr.io/danicallero/hackos-api:${API_IMAGE_TAG}
    pull_policy: never
    command: [node, dist/worker.js]
    environment: {ROLE: worker, RELEASE: "${API_IMAGE_TAG}"}
    networks: [egress]
    healthcheck: {test: [CMD-SHELL, "wget -qO- http://127.0.0.1:9464/metrics"], interval: 1s, timeout: 1s, retries: 10}
  migrate:
    image: ghcr.io/danicallero/hackos-api:${API_IMAGE_TAG}
    pull_policy: never
networks:
  egress: {}
  private: {}
  edge: {}
EOF_COMPOSE
cp "$root/deploy/docker-compose.rolling.yml" "$test_dir/docker-compose.rolling.yml"
export HACKOS_APP_DIR="$test_dir" API_PUBLISH_PORT=13000 WEB_PUBLISH_PORT=13001 WORKER_METRICS_PUBLISH_PORT=19464
run_release() (
  app_dir="$test_dir"; compose_file="$app_dir/docker-compose.yml"
  compose_env_files=(); deploy_api=true; deploy_web=true
  export API_IMAGE_TAG="$1" WEB_IMAGE_TAG="$1"
  api_image_tag="$1"; web_image_tag="$1"
  valid_image_tag() { [[ "$1" =~ ^sha-[0-9a-f]{40}$ ]]; }
  compose() { docker compose -f "$compose_file" -p "$project_name" "$@"; }
  set -- staging "$1" true true manual "${2:-}"
  source "$root/deploy/scripts/rolling-deploy.sh"
)
run_release "sha-$one" enable-rolling
# An unhealthy replacement must leave all currently serving routes intact.
cat > "$test_dir/build/Dockerfile" <<EOF_BAD
FROM ghcr.io/danicallero/hackos-api:sha-$one
ENV FIXTURE_UNHEALTHY=1
EOF_BAD
docker build -q -t "ghcr.io/danicallero/hackos-api:sha-$bad" "$test_dir/build" >/dev/null
docker tag "ghcr.io/danicallero/hackos-api:sha-$bad" "ghcr.io/danicallero/hackos-web:sha-$bad"
set +e
run_release "sha-$bad"
failed_status=$?
set -e
[[ "$failed_status" -ne 0 ]]
[[ "$(curl -fsS "http://$test_host:13000/healthz")" == "sha-$one:" ]]
old_worker="$project_name-job-$one"
curl -fsS -X POST --data 'worker must finish' "http://$test_host:19464/slow" > "$test_dir/worker-response" &
worker_pid=$!
until docker exec "$old_worker" test -f /tmp/started; do sleep 0.1; done
old_api="$project_name-api-$one"
curl -fsS -X POST --data 'must finish' http://$test_host:13000/slow > "$test_dir/slow-response" &
request_pid=$!
until docker exec "$old_api" test -f /tmp/started; do sleep 0.1; done
run_release "sha-$two" &
deploy_pid=$!
deadline=$((SECONDS + 90))
until docker exec "$old_worker" test -f /tmp/stopping; do
  ((SECONDS < deadline)) || { echo 'Worker did not begin graceful handover'; exit 1; }
  sleep 0.2
done
docker exec "$old_worker" touch /tmp/release
wait "$worker_pid"
grep -Fxq "sha-$one:worker must finish" "$test_dir/worker-response"
until [[ "$(curl -fsS "http://$test_host:13000/healthz")" == "sha-$two:" ]]; do
  ((SECONDS < deadline)) || { echo 'Cutover did not complete'; exit 1; }
  sleep 0.2
done
docker exec "$old_api" touch /tmp/release
wait "$request_pid"
wait "$deploy_pid"
grep -Fxq "sha-$one:must finish" "$test_dir/slow-response"
[[ "$(curl -fsS http://$test_host:13000/healthz)" == "sha-$two:" ]]
[[ "$(curl -fsS http://$test_host:13001/_next/static/old-hash.js)" == 'immutable old chunk' ]]
[[ -z "$(docker ps -aq --filter "name=^$old_api$")" ]]
echo 'PASS: Docker bootstrap, unhealthy-candidate rejection, worker handover, upload across cutover, drain/removal and retained assets'
