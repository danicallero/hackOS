#!/usr/bin/env bash
# Sourced by incus-deploy.sh under the host deployment lock (H12, H22, H29).
# Never stop an active request, apply a migration, or restart a datastore here.
set -Eeuo pipefail
rollout_dir="$app_dir/rollout"
rollout_compose="$app_dir/docker-compose.rolling.yml"
[[ -r "$rollout_compose" ]] || { echo 'ERROR: missing rolling Compose definition' >&2; exit 1; }
export GATEWAY_IMAGE_TAG
bootstrap=false
if [[ ! -f "$rollout_dir/routes.json" ]]; then
  bootstrap=true
  [[ "$deploy_api" == true && "$deploy_web" == true ]] || { echo 'ERROR: bootstrap requires both API and web images' >&2; exit 1; }
  [[ "${6:-}" == enable-rolling ]] || { echo 'ERROR: explicit gateway bootstrap required' >&2; exit 1; }
  # Port ownership changes once. Do not silently claim this is an online migration.
  for service in api web worker; do
    [[ -z "$(compose ps --quiet --status running "$service")" ]] || {
      echo 'ERROR: first gateway installation needs a controlled window; stop legacy api/web/worker first' >&2; exit 1;
    }
  done
  mkdir -p "$rollout_dir/assets"
  chmod 0755 "$rollout_dir" "$rollout_dir/assets"
  chown 1000:1000 "$rollout_dir/assets"
  GATEWAY_IMAGE_TAG="$api_image_tag"
  printf '%s\n' "$GATEWAY_IMAGE_TAG" > "$rollout_dir/gateway-image"
  sha256sum "$compose_file" | cut -d' ' -f1 > "$rollout_dir/compose-sha"
  sha256sum "$rollout_compose" | cut -d' ' -f1 > "$rollout_dir/rolling-compose-sha"
else
  GATEWAY_IMAGE_TAG="$(cat "$rollout_dir/gateway-image")"
fi
valid_image_tag "$GATEWAY_IMAGE_TAG" || { echo 'ERROR: invalid gateway image tag' >&2; exit 1; }
rolling_compose() {
  docker compose "${compose_env_files[@]}" --file "$compose_file" --file "$rollout_compose" --project-name "$project_name" "$@"
}
# The gateway is infrastructure: never replace it during application releases.
gateway_id="$(rolling_compose ps --quiet gateway)"
if [[ "$bootstrap" == false ]]; then
  [[ -n "$gateway_id" && "$(docker inspect --format '{{.State.Health.Status}}' "$gateway_id")" == healthy ]] || {
    echo 'ERROR: gateway is not healthy; online deployment refused' >&2; exit 1;
  }
fi
[[ "$(sha256sum "$compose_file" | cut -d' ' -f1)" == "$(cat "$rollout_dir/compose-sha")" && "$(sha256sum "$rollout_compose" | cut -d' ' -f1)" == "$(cat "$rollout_dir/rolling-compose-sha")" ]] || {
  echo 'ERROR: runtime definition changed; a reviewed infrastructure rollout is required' >&2; exit 1;
}
# Reserve enough headroom for overlapping API/web limits plus the gateway.
available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
[[ "$available_kib" =~ ^[0-9]+$ && "$available_kib" -ge 4194304 ]] || {
  echo 'ERROR: online update needs at least 4 GiB available memory; old release retained' >&2; exit 1;
}
read_target() {
  docker exec "$gateway_id" node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync("/rollout/routes.json")); const name=new URL(r[process.argv[1]]).hostname; if(!/^hackos-(staging|production)-(api|web|job)-[a-f0-9]{40}$/.test(name))process.exit(1); console.log(name)' "$1"
}
old_api=""; old_web=""; old_worker=""
if [[ "$bootstrap" == false ]]; then old_api="$(read_target api)"; old_web="$(read_target web)"; old_worker="$(read_target worker)"; fi
new_api="$old_api"; new_web="$old_web"; new_worker="$old_worker"
candidates=()
cleanup_candidates() {
  # Only called before routing is switched. Running old containers are untouched.
  for container in "${candidates[@]}"; do
    if [[ "$container" == *-job-* ]]; then docker stop --time -1 "$container" >/dev/null 2>&1 || true; fi
    docker rm -f "$container" >/dev/null 2>&1 || true
  done
  if [[ -n "$old_worker" && "$new_worker" != "$old_worker" ]]; then docker start "$old_worker" >/dev/null; fi
}
trap cleanup_candidates EXIT
candidate_health() {
  local name="$1" status attempt
  for attempt in {1..60}; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$name")"
    [[ "$status" != unhealthy ]] || { echo "ERROR: unhealthy candidate: $name" >&2; docker logs --tail 20 "$name" >&2; return 1; }
    [[ "$status" != healthy ]] || return 0
    sleep 2
  done
  echo "ERROR: candidate did not become healthy: $name" >&2; return 1
}
if [[ "$deploy_api" == true ]]; then
  # A read-only check. Candidate startup uses the same mode instead of running DDL.
  rolling_compose run --rm --no-deps migrate node dist/migrate.js --check
  new_api="$project_name-api-${api_image_tag#sha-}"
  new_worker="$project_name-job-${api_image_tag#sha-}"
  if [[ "$new_api" != "$old_api" ]]; then
    [[ -z "$(docker ps -aq --filter "name=^${new_api}$")" ]] || { echo 'ERROR: candidate name exists; inspect it before retrying' >&2; exit 1; }
    candidates+=("$new_api")
    rolling_compose run --detach --no-deps --name "$new_api" api node dist/server.js --check-schema
    candidate_health "$new_api"
  fi
fi
if [[ "$deploy_web" == true ]]; then
  new_web="$project_name-web-${web_image_tag#sha-}"
  if [[ "$new_web" != "$old_web" ]]; then
    [[ -z "$(docker ps -aq --filter "name=^${new_web}$")" ]] || { echo 'ERROR: candidate name exists; inspect it before retrying' >&2; exit 1; }
    candidates+=("$new_web")
    rolling_compose run --detach --no-deps --name "$new_web" web
    candidate_health "$new_web"
    asset_stage="$(mktemp -d "$app_dir/.assets.XXXXXX")"
    docker cp "$new_web:/repo/apps/web/.next/static/." "$asset_stage/"
    chmod -R a+rX "$asset_stage"
    # Import with the candidate binary; never change the gateway image in-place.
    rolling_compose run --rm --no-deps --volume "$asset_stage:/asset-source:ro" --volume "$rollout_dir/assets:/asset-dest" --entrypoint /usr/local/bin/rollout-gateway migrate assets /asset-source /asset-dest
    rm -rf "$asset_stage"
  fi
fi
# Worker handover waits indefinitely for accepted jobs. Docker must not SIGKILL
# a dispatcher mid-send merely because the default ten-second timeout elapsed.
# Do this before switching routes; a failed candidate leaves old HTTP untouched.
if [[ "$new_worker" != "$old_worker" ]]; then
  [[ -z "$(docker ps -aq --filter "name=^${new_worker}$")" ]] || { echo 'ERROR: worker candidate name exists; inspect it before retrying' >&2; exit 1; }
  if [[ -n "$old_worker" ]]; then docker stop --time -1 "$old_worker"; fi
  candidates+=("$new_worker")
  if ! rolling_compose run --detach --no-deps --name "$new_worker" worker || ! candidate_health "$new_worker"; then
    cleanup_candidates
    exit 1
  fi
fi
# One atomic pointer switches API, web and worker metrics together.
if [[ "$bootstrap" == false ]]; then cp "$rollout_dir/routes.json" "$rollout_dir/routes.previous.json"; fi
printf '{"api":"http://%s:3000","web":"http://%s:3001","worker":"http://%s:9464"}\n' "$new_api" "$new_web" "$new_worker" > "$rollout_dir/routes.next.json"
chmod 0644 "$rollout_dir/routes.next.json"
# Disable cleanup before publishing the durable pointer: a gateway restart may
# load it even before the reload command is acknowledged.
trap - EXIT
mv "$rollout_dir/routes.next.json" "$rollout_dir/routes.json"
if [[ "$bootstrap" == true ]]; then
  rolling_compose up --detach --no-deps --pull never gateway
  gateway_id="$(rolling_compose ps --quiet gateway)"
  candidate_health "$gateway_id"
elif ! docker exec "$gateway_id" wget -qO- --post-data='' http://127.0.0.1:3002/reload; then
  cp "$rollout_dir/routes.previous.json" "$rollout_dir/routes.restore.json"
  mv "$rollout_dir/routes.restore.json" "$rollout_dir/routes.json"
  docker exec "$gateway_id" wget -qO- --post-data='' http://127.0.0.1:3002/reload || true
  echo 'ERROR: cutover outcome uncertain; both HTTP generations retained for inspection' >&2
  exit 1
fi
# Confirm the public gateway reaches both replacements before retiring anything.
if ! docker exec "$gateway_id" wget -qO- --timeout=5 --tries=1 http://127.0.0.1:3000/healthz >/dev/null || ! docker exec "$gateway_id" wget -qO- --timeout=5 --tries=1 http://127.0.0.1:3001/ >/dev/null; then
  if [[ "$bootstrap" == false ]]; then
    if [[ "$new_worker" != "$old_worker" ]]; then
      docker stop --time -1 "$new_worker"
      docker start "$old_worker"
    fi
    cp "$rollout_dir/routes.previous.json" "$rollout_dir/routes.restore.json"
    mv "$rollout_dir/routes.restore.json" "$rollout_dir/routes.json"
    docker exec "$gateway_id" wget -qO- --post-data='' http://127.0.0.1:3002/reload || true
  fi
  echo 'ERROR: routed smoke check failed; prior routes restored where possible; generations retained for inspection' >&2
  exit 1
fi
# Wait without a kill deadline. A long upload/export keeps its old container alive.
for pair in "api:$old_api:3000:$new_api" "web:$old_web:3001:$new_web"; do
  IFS=: read -r kind container port current <<< "$pair"
  [[ -n "$container" && "$container" != "$current" ]] || continue
  until docker exec "$gateway_id" wget -qO- "http://127.0.0.1:3002/drained?target=http://$container:$port"; do
    echo "WAIT: draining $kind requests on $container"; sleep 2
  done
  docker stop --time -1 "$container"
  docker rm "$container"
done
if [[ -n "$old_worker" && "$old_worker" != "$new_worker" ]]; then docker rm "$old_worker"; fi
echo 'OK: healthy application cutover and request drain completed'
