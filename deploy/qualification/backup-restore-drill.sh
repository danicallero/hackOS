#!/usr/bin/env bash
# Rehearse backup -> verify -> restore -> undo against throwaway PostgreSQL,
# Valkey and MinIO containers, with a second MinIO standing in for AWS S3 (#539).
# It drives the real deploy/scripts/backup.sh, so it proves the lock, the
# database swap, the object sync and the rollback without touching any host.
#
#   deploy/qualification/backup-restore-drill.sh
#
# Needs Docker. PostgreSQL and Valkey use the digests pinned in deploy/docker-compose.yml;
# override DRILL_MINIO_IMAGE / DRILL_MINIO_DATA / DRILL_MC_PATH for another MinIO build.
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
compose_src="$root/deploy/docker-compose.yml"
backup_sh="$root/deploy/scripts/backup.sh"
work="$(mktemp -d)"
project=hackos-staging

pinned() { grep -o "$1@sha256:[a-f0-9]*" "$compose_src" | head -n 1; }
postgres_image="${DRILL_POSTGRES_IMAGE:-$(pinned postgres)}"
valkey_image="${DRILL_VALKEY_IMAGE:-$(pinned valkey/valkey)}"
# Any MinIO build that ships `mc`. The deploy compose pins a quay.io digest that
# anonymous pulls (CI) cannot fetch, so the drill defaults to a public image.
minio_image="${DRILL_MINIO_IMAGE:-bitnamilegacy/minio:latest}"
minio_data="${DRILL_MINIO_DATA:-/bitnami/minio/data}"
mc_path="${DRILL_MC_PATH:-/opt/bitnami/minio-client/bin:/opt/bitnami/minio/bin}"

command -v docker >/dev/null 2>&1 || { echo 'docker is required' >&2; exit 2; }
if ! command -v flock >/dev/null 2>&1; then
  # macOS has no flock; the drill runs one operation at a time.
  mkdir -p "$work/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$work/bin/flock"
  chmod +x "$work/bin/flock"
  export PATH="$work/bin:$PATH"
fi

# backup.sh derives its Compose project from the environment name, so the drill
# owns `hackos-staging`; never run it on a host that has the real one.
if [[ -n "$(docker ps -aq --filter label=com.docker.compose.project=hackos-staging)" ]]; then
  echo 'a hackos-staging Compose project already exists here; refusing to run the drill' >&2
  exit 2
fi

mkdir -p "$work/data"
cat >"$work/docker-compose.yml" <<YAML
x-minio: &minio
  image: $minio_image
  environment:
    PATH: $mc_path:/usr/local/bin:/usr/bin:/bin
    MINIO_ROOT_USER: "\${MINIO_ROOT_USER}"
    MINIO_ROOT_PASSWORD: "\${MINIO_ROOT_PASSWORD}"
    S3_BUCKET: "\${S3_BUCKET}"
x-health: &minio-ready
  test: ["CMD-SHELL", "mc ready local"]
  interval: 2s
  retries: 30
services:
  postgres:
    image: $postgres_image
    environment:
      POSTGRES_USER: "\${POSTGRES_USER}"
      POSTGRES_PASSWORD: "\${POSTGRES_PASSWORD}"
      POSTGRES_DB: "\${POSTGRES_DB}"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \$\${POSTGRES_USER} -d \$\${POSTGRES_DB}"]
      interval: 2s
      retries: 30
  valkey:
    image: $valkey_image
    command: ["valkey-server", "--requirepass", "\${VALKEY_PASSWORD}"]
    environment:
      VALKEY_PASSWORD: "\${VALKEY_PASSWORD}"
    healthcheck:
      test: ["CMD-SHELL", "valkey-cli -a \$\${VALKEY_PASSWORD} --no-auth-warning ping"]
      interval: 2s
      retries: 30
  minio:
    <<: *minio
    command: ["minio", "server", "$minio_data"]
    healthcheck: *minio-ready
  fake-s3:
    <<: *minio
    command: ["minio", "server", "$minio_data"]
    healthcheck: *minio-ready
  minio-init:
    <<: *minio
    entrypoint: ["/bin/sh", "-c"]
    command: ["true"]
    restart: "no"
  backup-sync:
    <<: *minio
    profiles: ["backup"]
    entrypoint: ["/bin/sh", "-c"]
    restart: "no"
  migrate:
    image: alpine:latest
    command: ["true"]
    restart: "no"
  api:
    image: alpine:latest
    command: ["sleep", "100000"]
    labels:
      drill.api-tag: "\${API_IMAGE_TAG:?API_IMAGE_TAG must reach Compose}"
    healthcheck: {test: ["CMD-SHELL", "true"], interval: 2s}
    depends_on:
      migrate: {condition: service_completed_successfully}
  worker:
    image: alpine:latest
    command: ["sleep", "100000"]
    healthcheck: {test: ["CMD-SHELL", "true"], interval: 2s}
YAML
cat >"$work/hackos.env" <<ENV
POSTGRES_USER=hackos
POSTGRES_PASSWORD=drillpg
POSTGRES_DB=hackos
MINIO_ROOT_USER=drilladmin
MINIO_ROOT_PASSWORD=drillminio123
S3_BUCKET=hackos
VALKEY_PASSWORD=drillvk
HACKOS_DATA_DIR=$work/data
BACKUPS_ENABLED=true
BACKUP_FREQUENCY=daily
BACKUP_S3_REGION=eu-west-1
BACKUP_S3_BUCKET=hackos-backups
BACKUP_S3_PREFIX=hackos
BACKUP_S3_ACCESS_KEY_ID=drilladmin
BACKUP_S3_SECRET_ACCESS_KEY=drillminio123
ENV
chmod 600 "$work/hackos.env"
# Like a deployed host: hackos.env has no IMAGE_TAG, the deploy records tags here.
printf 'API_IMAGE_TAG=sha-%s\nWEB_IMAGE_TAG=sha-%s\n' "$(printf 'a%.0s' {1..40})" "$(printf 'b%.0s' {1..40})" >"$work/.image-tags"

export HACKOS_APP_DIR="$work" HACKOS_COMPOSE_FILE="$work/docker-compose.yml" HACKOS_CONFIG_FILE="$work/hackos.env" \
  HACKOS_SECRETS_FILE="$work/none" HACKOS_LOCK_FILE="$work/.lock" HACKOS_BACKUP_S3_ENDPOINT=http://fake-s3:9000 \
  HACKOS_DRAIN_SECONDS=3 HACKOS_BACKUP_DRILL=true

c() { docker compose --env-file "$work/hackos.env" --env-file "$work/.image-tags" -p "$project" -f "$work/docker-compose.yml" "$@"; }
backup() { "$backup_sh" staging "$@"; }
pg() { c exec -T postgres sh -c "PGPASSWORD=drillpg psql -qtA -U hackos -d $1" <<<"$2"; }
mc_run() { c run --rm --no-deps -T --entrypoint /bin/sh minio-init -c "mc alias set l http://minio:9000 drilladmin drillminio123 >/dev/null; mc alias set o http://fake-s3:9000 drilladmin drillminio123 >/dev/null; $1"; }
step() { printf '\n== %s\n' "$*"; }
expect() { # label actual expected
  if [[ "$2" != "$3" ]]; then printf 'FAIL: %s: got [%s], want [%s]\n' "$1" "$2" "$3" >&2; exit 1; fi
  printf 'ok: %s\n' "$1"
}

cleanup() {
  local status=$?
  if ((status != 0)) && [[ -f "$work/restore.log" ]]; then
    echo '--- restore.log' >&2
    cat "$work/restore.log" >&2
  fi
  c down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

step "start throwaway services"
# backup.sh starts services with --pull never, as on a deployed host.
docker pull -q alpine:latest >/dev/null
c up -d --wait postgres valkey minio fake-s3 >/dev/null
mc_run 'mc mb --ignore-existing o/hackos-backups; mc mb --ignore-existing l/hackos' >/dev/null
pg hackos "
  CREATE TABLE _migrations(name text primary key); INSERT INTO _migrations VALUES ('0001_base.sql'),('0801_x.sql');
  CREATE TABLE audit_log (id serial primary key, actor_id int, entity_type text not null, entity_id text not null, action text not null,
    source text, before jsonb, after jsonb, reason text, ip text, user_agent text, created_at timestamptz default now() not null);
  CREATE TABLE t1(v text);
  $(for i in $(seq 2 12); do printf 'CREATE TABLE t%s(v int); ' "$i"; done)
  INSERT INTO t1 VALUES ('v1');" >/dev/null
mc_run 'echo v1 | mc pipe l/hackos/file1.txt' >/dev/null

step "no snapshot yet: status must fail"
set +e; backup status >/dev/null 2>&1; expect "status exit without snapshot" "$?" 1; set -e

step "backup, list, status, verify"
backup create >/dev/null
expect "one snapshot listed" "$(backup list | grep -c '^[0-9]\{8\}T')" 1
backup status >/dev/null; expect "status healthy" "$?" 0
backup verify latest | tail -n 1

step "live data drifts after the snapshot"
pg hackos "DELETE FROM t1; INSERT INTO t1 VALUES ('v2');" >/dev/null
mc_run 'echo v2 | mc pipe l/hackos/file2.txt' >/dev/null

step "restore (lock must appear while it runs)"
( backup restore latest --yes >"$work/restore.log" 2>&1 ) &
restore_pid=$!
lock_seen=none
for _ in $(seq 1 240); do
  if [[ -f "$work/data/maintenance/state.json" ]]; then lock_seen="$(cat "$work/data/maintenance/state.json")"; break; fi
  sleep 0.5
done
wait "$restore_pid"
expect "lock phase seen" "$(printf '%s' "$lock_seen" | sed -n 's/.*"phase":"\([a-z]*\)".*/\1/p')" draining
expect "lock cleared" "$(ls "$work/data/maintenance")" ""
expect "database rolled back" "$(pg hackos 'SELECT v FROM t1')" v1
expect "audit row written" "$(pg hackos 'SELECT action FROM audit_log')" database.restored
expect "objects kept" "$(mc_run 'mc ls l/hackos' | awk '{print $NF}' | sort | paste -sd, -)" "file1.txt,file2.txt"

step "undo"
backup undo --yes >/dev/null
expect "undo brings the newer data back" "$(pg hackos 'SELECT v FROM t1')" v2
expect "undo audited" "$(pg hackos 'SELECT action FROM audit_log')" database.restore_undone

step "restore of a broken snapshot fails before the swap"
mc_run 'echo garbage | mc pipe o/hackos-backups/hackos/staging/snapshots/20990101T000000Z/postgres.dump
  printf "environment=staging\nimage_tag=x\nmigration_head=0801_x.sql\ncreated_at=x\ndump_size=8\ndump_etag=x\n" | mc pipe o/hackos-backups/hackos/staging/snapshots/20990101T000000Z/manifest.txt' >/dev/null
pg hackos "UPDATE t1 SET v='untouched'" >/dev/null
set +e; backup restore 20990101T000000Z --yes >/dev/null 2>&1; expect "restore exit" "$?" 1; set -e
expect "live data untouched" "$(pg hackos 'SELECT v FROM t1')" untouched
expect "no stuck lock" "$(ls "$work/data/maintenance")" ""

step "unlock a stuck lock"
echo '{"phase":"failed"}' >"$work/data/maintenance/state.json"
backup unlock --yes >/dev/null
expect "unlock clears it" "$(ls "$work/data/maintenance")" ""

printf '\nbackup/restore drill passed\n'
