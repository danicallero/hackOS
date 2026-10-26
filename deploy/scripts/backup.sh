#!/usr/bin/env bash
# Back up to AWS S3, verify, restore and roll back (#539).
#
#   backup.sh <environment> [create]            take a snapshot (default; used by deploys and timers)
#   backup.sh <environment> list                recent snapshots
#   backup.sh <environment> status              freshness, maintenance lock, leftover databases
#   backup.sh <environment> verify [ID|latest]  timed restore into a scratch database; live data untouched
#   backup.sh <environment> restore [ID|latest] [--yes] [--no-pre-backup]
#   backup.sh <environment> undo [--yes]        swap back to the database replaced by the last restore
#   backup.sh <environment> unlock [--yes]      clear a stuck maintenance lock
#   backup.sh <environment> drop-prev NAME      drop a *_prev_* / *_undone_* database
#
# The S3 bucket is intentionally provisioned outside this repository. S3 commands
# only run when BACKUPS_ENABLED=true in the deployment environment.
set -Eeuo pipefail

environment="${1:-production}"
case "$environment" in
  production|staging) ;;
  *)
    echo "ERROR: environment must be production or staging" >&2
    exit 2
    ;;
esac
# Only production is backed up. The drill (deploy/qualification) runs the script
# under the staging project name against throwaway containers and opts in here.
if [[ "$environment" != production && "${HACKOS_BACKUP_DRILL:-}" != true ]]; then
  echo "ERROR: backups are production-only" >&2
  exit 2
fi
command="${2:-create}"
shift $(($# > 2 ? 2 : $#))
case "$command" in
  create|list|status|verify|restore|undo|unlock|drop-prev) ;;
  *)
    echo "ERROR: unknown command: $command" >&2
    exit 2
    ;;
esac

app_dir="${HACKOS_APP_DIR:-/opt/hackos}"
compose_file="${HACKOS_COMPOSE_FILE:-$app_dir/docker-compose.yml}"
project_name="hackos-$environment"
lock_file="${HACKOS_LOCK_FILE:-$app_dir/.deploy.lock}"
config_file="${HACKOS_CONFIG_FILE:-/etc/hackos/hackos.env}"
secrets_file="${HACKOS_SECRETS_FILE:-/etc/hackos/hackos.secrets}"

die() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -f "$compose_file" ]] || die "deployment Compose file is missing"

compose_env_files=()
env_files=()
if [[ -f "$config_file" && -f "$secrets_file" ]]; then
  compose_env_files=(--env-file "$config_file" --env-file "$secrets_file")
  env_files=("$config_file" "$secrets_file")
elif [[ -f "$config_file" ]]; then
  compose_env_files=(--env-file "$config_file")
  env_files=("$config_file")
elif [[ -f "$secrets_file" ]]; then
  die "configuration file is missing; a secrets file cannot be used alone"
else
  die "/etc/hackos environment files are missing"
fi

require_private_file() {
  local file="$1"
  local mode

  mode="$(stat -c '%a' "$file" 2>/dev/null || stat -f '%Lp' "$file")"
  [[ "$mode" == 600 ]] || die "secret environment file must have mode 600: $file"
}

if [[ "${#env_files[@]}" -eq 1 ]]; then
  require_private_file "${env_files[0]}"
else
  require_private_file "$secrets_file"
fi

command -v docker >/dev/null 2>&1 || die "Docker is not available"
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available"
command -v flock >/dev/null 2>&1 || die "flock is not available"

if [[ "$command" != list && "$command" != status && "${HACKOS_LOCK_HELD:-false}" != true ]]; then
  mkdir -p "$app_dir"
  exec 9>"$lock_file"
  flock -n 9 || die "another hackOS operation is already running"
fi

env_value() {
  local key="$1"
  local file entry value
  local index

  for ((index = ${#env_files[@]} - 1; index >= 0; index--)); do
    file="${env_files[index]}"
    entry="$(awk -v key="$key" '
      /^[[:space:]]*(#|$)/ { next }
      {
        line = $0
        sub(/^[[:space:]]*/, "", line)
        split(line, fields, "=")
        if (fields[1] == key) {
          sub(/^[^=]*=/, "", line)
          value = line
          found = 1
        }
      }
      END { printf "%d\t%s", found ? 1 : 0, value }
    ' "$file")"
    if [[ "${entry%%$'\t'*}" == 1 ]]; then
      value="${entry#*$'\t'}"
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      printf '%s' "$value"
      return 0
    fi
  done
}

require_value() {
  local key="$1"
  local result
  result="$(env_value "$key")"
  [[ -n "$result" ]] || die "$key is missing or empty"
  [[ "$result" != *CHANGE_ME* ]] || die "$key still contains CHANGE_ME"
  [[ "$result" != *REPLACE_WITH* ]] || die "$key still contains REPLACE_WITH"
  printf '%s' "$result"
}

backups_enabled="$(env_value BACKUPS_ENABLED)"
backups_enabled="${backups_enabled:-false}"
backup_frequency="$(env_value BACKUP_FREQUENCY)"
backup_frequency="${backup_frequency:-disabled}"

postgres_user="$(require_value POSTGRES_USER)"
postgres_db="$(require_value POSTGRES_DB)"
postgres_password="$(require_value POSTGRES_PASSWORD)"
minio_root_user="$(require_value MINIO_ROOT_USER)"
minio_root_password="$(require_value MINIO_ROOT_PASSWORD)"
s3_bucket="$(env_value S3_BUCKET)"
s3_bucket="${s3_bucket:-hackos}"
image_tag="${IMAGE_TAG:-$(env_value IMAGE_TAG)}"
data_dir="$(env_value HACKOS_DATA_DIR)"
data_dir="${data_dir:-/mnt/data}"

[[ "$postgres_db" =~ ^[A-Za-z0-9_]+$ ]] || die "POSTGRES_DB must contain only letters, digits and underscores"
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || die "IMAGE_TAG must match sha-<40 lowercase hex characters>"
[[ "$data_dir" == /* && "$data_dir" != "/" ]] || die "HACKOS_DATA_DIR must be an absolute path other than /"
[[ "$data_dir" != *$'\n'* && "$data_dir" != *$'\r'* ]] || die "HACKOS_DATA_DIR contains a newline"
if [[ "$environment" == production ]]; then
  command -v mountpoint >/dev/null 2>&1 || die "mountpoint is not available"
  mountpoint -q "$data_dir" || die "production data path is not a mounted persistent volume"
fi

needs_s3=true
case "$command" in undo|unlock|drop-prev) needs_s3=false ;; esac
[[ "$command" == status && "$backups_enabled" != true ]] && needs_s3=false
if [[ "$needs_s3" == true ]]; then
  [[ "$backups_enabled" == true ]] || die "BACKUPS_ENABLED is not true"
  s3_region="$(require_value BACKUP_S3_REGION)"
  backup_bucket="$(require_value BACKUP_S3_BUCKET)"
  backup_prefix="$(require_value BACKUP_S3_PREFIX)"
  backup_access_key_id="$(require_value BACKUP_S3_ACCESS_KEY_ID)"
  backup_secret_access_key="$(require_value BACKUP_S3_SECRET_ACCESS_KEY)"
  [[ "$s3_region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]+$ ]] || die "BACKUP_S3_REGION is not an AWS region name"
  [[ "$backup_bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "BACKUP_S3_BUCKET is not a valid bucket name"
  [[ "$backup_prefix" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || die "BACKUP_S3_PREFIX contains unsafe characters"
  [[ "$backup_prefix" != */ && "$backup_prefix" != *..* ]] || die "BACKUP_S3_PREFIX must not end in / or contain .."
  # HACKOS_BACKUP_S3_ENDPOINT is a test seam (deploy/test-backup-restore.sh).
  export BACKUP_S3_ENDPOINT="${HACKOS_BACKUP_S3_ENDPOINT:-https://s3.$s3_region.amazonaws.com}"
  export BACKUP_S3_BUCKET="$backup_bucket"
  export BACKUP_S3_ACCESS_KEY_ID="$backup_access_key_id"
  export BACKUP_S3_SECRET_ACCESS_KEY="$backup_secret_access_key"
  export SNAP_ROOT="$backup_prefix/$environment"
fi

export IMAGE_TAG="$image_tag"
export S3_BUCKET="$s3_bucket"
export POSTGRES_USER="$postgres_user"
export POSTGRES_DB="$postgres_db"
export POSTGRES_PASSWORD="$postgres_password"
export MINIO_ROOT_USER="$minio_root_user"
export MINIO_ROOT_PASSWORD="$minio_root_password"

maintenance_dir="$data_dir/maintenance"
maintenance_file="$maintenance_dir/state.json"
snapshot_re='^[0-9]{8}T[0-9]{6}Z$'

compose() {
  docker compose \
    "${compose_env_files[@]}" \
    --file "$compose_file" \
    --project-name "$project_name" \
    "$@"
}

run_quiet() {
  local description="$1"
  shift
  local output_file
  output_file="$(mktemp)"
  if ! "$@" >"$output_file" 2>&1; then
    rm -f "$output_file"
    die "$description failed"
  fi
  rm -f "$output_file"
}

wait_for_health() {
  local service="$1"
  local container_id status attempt

  for attempt in {1..60}; do
    container_id="$(compose ps --quiet "$service" 2>/dev/null || true)"
    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null || true)"
      case "$status" in
        healthy) return 0 ;;
        unhealthy) die "$service healthcheck reported unhealthy" ;;
      esac
    fi
    sleep 2
  done

  die "$service healthcheck timed out"
}

say() { printf '%s\n' "$*"; }

# --- S3 access (mc runs in the already-pinned minio-init image) -------------

# Runs a /bin/sh snippet with the `local` (MinIO) and `offsite` (S3) aliases set. Variables the
# snippet reads must be exported by the caller (SNAP_ID, BACKUP_S3_OBJECT, …).
mc_offsite() {
  compose run --rm --no-deps -T \
    -e BACKUP_S3_ENDPOINT -e BACKUP_S3_ACCESS_KEY_ID -e BACKUP_S3_SECRET_ACCESS_KEY \
    -e BACKUP_S3_BUCKET -e SNAP_ROOT -e SNAP_ID -e BACKUP_S3_OBJECT -e BACKUP_S3_OBJECT_PREFIX \
    -e BACKUP_DUMP_OBJECT -e BACKUP_MIGRATION_HEAD -e BACKUP_ENVIRONMENT -e BACKUP_IMAGE_TAG \
    -e BACKUP_CREATED_AT \
    --entrypoint /bin/sh minio-init \
    -c "set -eu
      mc alias set local http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null
      mc alias set offsite \"\$BACKUP_S3_ENDPOINT\" \"\$BACKUP_S3_ACCESS_KEY_ID\" \"\$BACKUP_S3_SECRET_ACCESS_KEY\" >/dev/null
      $1"
}

manifest_value() { # manifest-text key
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1
}

snapshot_ids() { # newest first
  mc_offsite 'mc ls "offsite/$BACKUP_S3_BUCKET/$SNAP_ROOT/snapshots/"' 2>/dev/null |
    awk '{print $NF}' | sed 's#/$##' | grep -E "$snapshot_re" | sort -r || true
}

read_manifest() { # id -> manifest text, nonzero when the snapshot is incomplete
  SNAP_ID="$1" mc_offsite 'mc cat "offsite/$BACKUP_S3_BUCKET/$SNAP_ROOT/snapshots/$SNAP_ID/manifest.txt"' 2>/dev/null
}

# Resolves an ID or `latest` to the newest snapshot that has its manifest.
# Returns 1 (instead of exiting) when there is none, so `status` can report it.
try_resolve_snapshot() {
  local wanted="${1:-latest}" candidate
  if [[ "$wanted" != latest ]]; then
    [[ "$wanted" =~ $snapshot_re ]] || die "snapshot must be latest or YYYYMMDDTHHMMSSZ"
    export SNAP_ID="$wanted"
    snapshot_manifest="$(read_manifest "$wanted")" || return 1
    return 0
  fi
  while IFS= read -r candidate; do
    if snapshot_manifest="$(read_manifest "$candidate")"; then
      export SNAP_ID="$candidate"
      return 0
    fi
  done < <(snapshot_ids)
  return 1
}

resolve_snapshot() {
  try_resolve_snapshot "$@" || die "no complete snapshot found (${1:-latest}) under $SNAP_ROOT/snapshots/"
}

epoch_of() { # YYYYMMDDTHHMMSSZ -> epoch seconds
  local id="$1" iso
  iso="${id:0:4}-${id:4:2}-${id:6:2} ${id:9:2}:${id:11:2}:${id:13:2}"
  date -u -d "$iso" +%s 2>/dev/null || date -ju -f '%Y-%m-%d %H:%M:%S' "$iso" +%s
}

# --- PostgreSQL helpers -----------------------------------------------------

psql_admin() { # SQL on stdin-free form; runs against the maintenance database
  compose exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -qtA --username "$POSTGRES_USER" --dbname postgres' <<<"$1"
}

psql_in() { # database SQL
  compose exec -T -e TARGET_DB="$1" postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -qtA --username "$POSTGRES_USER" --dbname "$TARGET_DB"' <<<"$2"
}

start_stateful() {
  run_quiet "start stateful services" compose up --detach --no-build --pull never postgres valkey minio
  wait_for_health postgres
  wait_for_health valkey
  wait_for_health minio
}

# Streams the snapshot's dump into a freshly created database.
restore_into() { # database
  local db="$1"
  export BACKUP_S3_OBJECT="$SNAP_ROOT/snapshots/$SNAP_ID/postgres.dump"
  psql_admin "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE); CREATE DATABASE \"$db\";"
  mc_offsite 'mc cat "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"' |
    compose exec -T -e TARGET_DB="$db" postgres sh -c \
      'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --single-transaction --exit-on-error --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$TARGET_DB"' ||
    die "pg_restore into $db failed"
}

# Checks a restored database against the manifest: same migration head and a
# non-empty schema, and that the uploaded dump matches the recorded size/ETag.
verify_database() { # database
  local db="$1" head tables stat size etag
  head="$(psql_in "$db" 'SELECT max(name) FROM public._migrations' | tr -d '[:space:]')"
  [[ -z "$(manifest_value "$snapshot_manifest" migration_head)" || "$head" == "$(manifest_value "$snapshot_manifest" migration_head)" ]] ||
    die "restored migration head $head does not match the manifest"
  tables="$(psql_in "$db" "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" | tr -d '[:space:]')"
  [[ "${tables:-0}" -gt 10 ]] || die "restored database has only ${tables:-0} tables"
  export BACKUP_S3_OBJECT="$SNAP_ROOT/snapshots/$SNAP_ID/postgres.dump"
  stat="$(mc_offsite 'mc stat --json "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"')"
  size="$(printf '%s' "$stat" | sed -n 's/.*"size":\([0-9]*\).*/\1/p')"
  etag="$(printf '%s' "$stat" | sed -n 's/.*"etag":"\([^"]*\)".*/\1/p')"
  [[ -z "$(manifest_value "$snapshot_manifest" dump_size)" || "$size" == "$(manifest_value "$snapshot_manifest" dump_size)" ]] ||
    die "dump size differs from the manifest"
  [[ -z "$(manifest_value "$snapshot_manifest" dump_etag)" || "$etag" == "$(manifest_value "$snapshot_manifest" dump_etag)" ]] ||
    die "dump ETag differs from the manifest"
  say "  migrations at $head, $tables tables"
}

# --- maintenance lock -------------------------------------------------------

write_state() { # phase
  local tmp
  install -d -m 755 "$maintenance_dir"
  tmp="$(mktemp "$maintenance_dir/.state.XXXXXX")"
  printf '{"phase":"%s","restoreId":"%s","startedAt":"%s","etaAt":"%s"}\n' \
    "$1" "${restore_id:-}" "${lock_started_at:-}" "${lock_eta_at:-}" >"$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$maintenance_file"
}

clear_state() { rm -f "$maintenance_file"; }

open_lock() { # eta-minutes
  restore_id="$(date -u +%Y%m%dT%H%M%SZ)"
  lock_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  lock_eta_at="$(date -u -d "+${1} minutes" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+"${1}"M +%Y-%m-%dT%H:%M:%SZ)"
  write_state draining
  say "Maintenance lock on; waiting ${drain_seconds}s for in-flight requests."
  sleep "$drain_seconds"
  compose stop worker >/dev/null 2>&1 || true
}

confirm() { # sentence
  [[ "$assume_yes" == true ]] && return 0
  [[ -t 0 ]] || die "confirmation needed: rerun with --yes or from a terminal"
  local answer
  read -r -p "$1 Type '$command $environment' to continue: " answer
  [[ "$answer" == "$command $environment" ]] || die "not confirmed"
}

swap_databases() { # live incoming previous
  psql_admin "
    ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS false;
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$1' AND pid <> pg_backend_pid();
    ALTER DATABASE \"$1\" RENAME TO \"$3\";
    ALTER DATABASE \"$2\" RENAME TO \"$1\";
    ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS true;" >/dev/null
}

bring_up() {
  compose exec -T valkey sh -c 'valkey-cli -a "$VALKEY_PASSWORD" --no-auth-warning FLUSHALL' >/dev/null
  run_quiet "start api and worker" compose up --detach --no-build --pull never --force-recreate \
    --wait --wait-timeout 180 api worker
}

record_audit() { # action snapshot detail (all pre-validated)
  local operator="${SUDO_USER:-$(id -un)}"
  operator="${operator//[^A-Za-z0-9._-]/}"
  psql_in "$postgres_db" "
    INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, after, reason)
    VALUES (NULL, 'database', 'restore', '$1', 'admin',
      jsonb_build_object('snapshot', '$2', 'restoreId', '${restore_id:-}', 'detail', '$3', 'operator', '$operator'),
      'Operator database restore (#539)');" >/dev/null
}

# --- commands ---------------------------------------------------------------

create_snapshot() {
  local timestamp object_prefix pg_error
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  object_prefix="$SNAP_ROOT/snapshots/$timestamp"
  export BACKUP_S3_OBJECT="$object_prefix/postgres.dump"

  run_quiet "validate Compose" compose config --quiet
  run_quiet "start backup dependencies" compose up --detach postgres minio
  wait_for_health postgres
  wait_for_health minio

  pg_error="$(mktemp)"
  if ! compose exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
    2>"$pg_error" |
    mc_offsite 'mc pipe "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"' >>"$pg_error" 2>&1; then
    rm -f "$pg_error"
    die "PostgreSQL backup failed"
  fi
  rm -f "$pg_error"

  # Only the latest version of each file is kept: one incremental mirror
  # replaces a full copy per snapshot (S3 storage is billed per GB-month) and
  # the bucket is not versioned. Nothing is removed, because a restored database
  # may still reference a file deleted after the snapshot.
  export BACKUP_S3_OBJECT_PREFIX="$SNAP_ROOT/minio"
  run_quiet "MinIO backup" mc_offsite \
    'mc mirror --overwrite "local/$S3_BUCKET" "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT_PREFIX"'

  # Restore reads this to detect a truncated upload before touching live data.
  export BACKUP_MIGRATION_HEAD
  BACKUP_MIGRATION_HEAD="$(psql_in "$postgres_db" 'SELECT max(name) FROM public._migrations' | tr -d '[:space:]')"
  [[ -n "$BACKUP_MIGRATION_HEAD" ]] || die "could not read the migration head"

  # The manifest is written last: its presence marks a complete snapshot.
  export BACKUP_DUMP_OBJECT="$BACKUP_S3_OBJECT"
  export BACKUP_S3_OBJECT="$object_prefix/manifest.txt"
  export BACKUP_ENVIRONMENT="$environment"
  export BACKUP_IMAGE_TAG="$image_tag"
  export BACKUP_CREATED_AT
  BACKUP_CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run_quiet "backup manifest" mc_offsite '
    stat="$(mc stat --json "offsite/$BACKUP_S3_BUCKET/$BACKUP_DUMP_OBJECT")"
    dump_size="$(printf "%s" "$stat" | sed -n "s/.*\"size\":\([0-9]*\).*/\1/p")"
    dump_etag="$(printf "%s" "$stat" | sed -n "s/.*\"etag\":\"\([^\"]*\)\".*/\1/p")"
    [ -n "$dump_size" ] && [ "$dump_size" -gt 0 ] || { echo "empty dump" >&2; exit 1; }
    printf "environment=%s\nimage_tag=%s\nmigration_head=%s\ncreated_at=%s\ndump_size=%s\ndump_etag=%s\n" \
      "$BACKUP_ENVIRONMENT" "$BACKUP_IMAGE_TAG" "$BACKUP_MIGRATION_HEAD" "$BACKUP_CREATED_AT" "$dump_size" "$dump_etag" |
      mc pipe "offsite/$BACKUP_S3_BUCKET/$BACKUP_S3_OBJECT"'

  created_snapshot="$timestamp"
  echo "OK: S3 backup created at $object_prefix"
}

cmd_list() {
  local id manifest count=0
  printf '%-18s %-16s %-30s %s\n' SNAPSHOT IMAGE MIGRATION DUMP_BYTES
  while IFS= read -r id; do
    if manifest="$(read_manifest "$id")"; then
      printf '%-18s %-16s %-30s %s\n' "$id" "$(manifest_value "$manifest" image_tag | cut -c1-12)" \
        "$(manifest_value "$manifest" migration_head)" "$(manifest_value "$manifest" dump_size)"
    else
      printf '%-18s incomplete (no manifest)\n' "$id"
    fi
    count=$((count + 1))
    ((count < ${1:-15})) || break
  done < <(snapshot_ids)
  ((count > 0)) || say "No snapshots under $SNAP_ROOT/snapshots/"
}

cmd_status() {
  local exit_code=0 latest age_h max_h state db
  say "Environment: $environment    BACKUPS_ENABLED=$backups_enabled    BACKUP_FREQUENCY=$backup_frequency"
  if [[ "$backups_enabled" == true ]]; then
    snapshot_manifest=''
    if try_resolve_snapshot latest; then
      latest="$SNAP_ID"
      age_h=$((($(date -u +%s) - $(epoch_of "$latest")) / 3600))
      case "$backup_frequency" in
        daily) max_h=26 ;;
        weekly) max_h=192 ;;
        monthly) max_h=768 ;;
        *) max_h=0 ;;
      esac
      say "Latest snapshot: $latest (${age_h}h old, image $(manifest_value "$snapshot_manifest" image_tag | cut -c1-12), migration $(manifest_value "$snapshot_manifest" migration_head))"
      if ((max_h > 0 && age_h > max_h)); then
        say "STALE: older than ${max_h}h for a $backup_frequency schedule"
        exit_code=1
      fi
    else
      say "NO COMPLETE SNAPSHOT found under $SNAP_ROOT/snapshots/"
      exit_code=1
    fi
  fi
  if [[ -f "$maintenance_file" ]]; then
    state="$(cat "$maintenance_file")"
    say "MAINTENANCE LOCK ACTIVE: $state"
    exit_code=1
  else
    say "Maintenance lock: off"
  fi
  if compose ps --quiet postgres 2>/dev/null | grep -q .; then
    db="$(psql_admin "SELECT datname || ' ' || pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname LIKE '${postgres_db}\\_prev\\_%' OR datname LIKE '${postgres_db}\\_undone\\_%' OR datname LIKE '${postgres_db}\\_incoming' OR datname LIKE '${postgres_db}\\_verify' ORDER BY 1" 2>/dev/null || true)"
    if [[ -n "$db" ]]; then
      say "Leftover databases (drop with: backup.sh $environment drop-prev NAME):"
      printf '%s\n' "$db" | sed 's/^/  /'
    fi
  fi
  return "$exit_code"
}

cmd_verify() {
  local started scratch="${postgres_db}_verify"
  start_stateful
  resolve_snapshot "${1:-latest}"
  say "Verifying snapshot $SNAP_ID in scratch database $scratch (live data untouched)"
  started="$(date -u +%s)"
  restore_into "$scratch"
  verify_database "$scratch"
  psql_admin "DROP DATABASE IF EXISTS \"$scratch\" WITH (FORCE)" >/dev/null
  say "OK: snapshot $SNAP_ID restores cleanly in $(($(date -u +%s) - started))s"
}

cmd_restore() {
  local previous incoming="${postgres_db}_incoming" started
  restore_target=''
  assume_yes=false
  local pre_backup=true
  while (($# > 0)); do
    case "$1" in
      --yes) assume_yes=true ;;
      --no-pre-backup) pre_backup=false ;;
      -*) die "unknown restore option: $1" ;;
      *) [[ -z "$restore_target" ]] || die "only one snapshot may be given"; restore_target="$1" ;;
    esac
    shift
  done
  [[ ! -f "$maintenance_file" ]] || die "a maintenance lock already exists; inspect with status, then undo or unlock"
  start_stateful
  resolve_snapshot "${restore_target:-latest}"
  say "Snapshot $SNAP_ID: image $(manifest_value "$snapshot_manifest" image_tag), migration $(manifest_value "$snapshot_manifest" migration_head), created $(manifest_value "$snapshot_manifest" created_at)"
  if [[ "$(manifest_value "$snapshot_manifest" image_tag)" != "$image_tag" ]]; then
    say "Note: the snapshot was taken on another image; the current images run and migrate forward."
  fi
  confirm "This replaces the live $environment database and object store contents with snapshot $SNAP_ID."

  started="$(date -u +%s)"
  swapped=false
  locked=false
  finished=false
  trap on_restore_exit EXIT
  # 1. Restore and verify off to the side while users are still online.
  say "[1/6] Restoring into $incoming and verifying"
  restore_into "$incoming"
  verify_database "$incoming"

  # 2. From here users are locked out; a failure before the swap reopens by itself.
  say "[2/6] Locking out users"
  locked=true
  open_lock 20
  if [[ "$pre_backup" == true ]]; then
    say "[3/6] Taking a pre-restore snapshot of the live state"
    create_snapshot >/dev/null
    say "  pre-restore snapshot $created_snapshot"
  fi

  write_state restoring
  previous="${postgres_db}_prev_${restore_id}"
  say "[4/6] Swapping databases ($postgres_db -> $previous)"
  swap_databases "$postgres_db" "$incoming" "$previous"
  swapped=true
  say "[5/6] Syncing object storage and restarting"
  run_quiet "MinIO restore" mc_offsite \
    'mc mirror --overwrite "offsite/$BACKUP_S3_BUCKET/$SNAP_ROOT/minio" "local/$S3_BUCKET"'
  write_state verifying
  bring_up
  record_audit database.restored "$SNAP_ID" "previous database $previous"
  say "[6/6] Reopening"
  clear_state
  finished=true
  trap - EXIT
  say "OK: restored snapshot $SNAP_ID in $(($(date -u +%s) - started))s."
  say "The replaced database is kept as $previous: 'backup.sh $environment undo' swaps it back; 'drop-prev $previous' frees the space."
  say "If the snapshot's image differs from the deployed one, align with: services.sh $environment deploy sha-<commit> --both"
}

on_restore_exit() {
  local rc=$?
  trap - EXIT
  [[ "$finished" == true ]] && exit "$rc"
  if [[ "$swapped" == true ]]; then
    write_state failed
    echo "FAILED after the database swap. The maintenance lock stays on." >&2
    echo "Roll back with: backup.sh $environment undo   — or fix and run: backup.sh $environment unlock" >&2
  else
    psql_admin "DROP DATABASE IF EXISTS \"${postgres_db}_incoming\" WITH (FORCE); ALTER DATABASE \"$postgres_db\" WITH ALLOW_CONNECTIONS true;" >/dev/null 2>&1 || true
    compose up --detach --no-build --pull never worker >/dev/null 2>&1 || true
    if [[ "$locked" == true ]]; then clear_state; fi
    echo "FAILED before the swap; the live database was not changed and users are reconnected." >&2
  fi
  exit "${rc:-1}"
}

cmd_undo() {
  local previous rid
  assume_yes=false
  [[ "${1:-}" != --yes ]] || assume_yes=true
  start_stateful
  previous="$(psql_admin "SELECT datname FROM pg_database WHERE datname LIKE '${postgres_db}\\_prev\\_%' ORDER BY datname DESC LIMIT 1")"
  [[ -n "$previous" ]] || die "no ${postgres_db}_prev_* database to roll back to"
  confirm "This swaps $postgres_db with $previous (the database replaced by the last restore)."
  swapped=false locked=true finished=false
  trap on_restore_exit EXIT
  open_lock 10
  rid="$restore_id"
  write_state restoring
  swap_databases "$postgres_db" "$previous" "${postgres_db}_undone_${rid}"
  swapped=true
  bring_up
  record_audit database.restore_undone "-" "kept ${postgres_db}_undone_${rid}"
  clear_state
  finished=true
  trap - EXIT
  say "OK: rolled back to $previous; the database you undid is kept as ${postgres_db}_undone_${rid}."
}

cmd_unlock() {
  assume_yes=false
  [[ "${1:-}" != --yes ]] || assume_yes=true
  [[ -f "$maintenance_file" ]] || { say "No maintenance lock."; return 0; }
  say "Current lock: $(cat "$maintenance_file")"
  confirm "Only unlock once the database is known to be consistent."
  clear_state
  run_quiet "start api and worker" compose up --detach --no-build --pull never api worker
  say "OK: maintenance lock cleared."
}

cmd_drop_prev() {
  local name="${1:-}"
  assume_yes=false
  [[ "${2:-}" != --yes ]] || assume_yes=true
  [[ "$name" =~ ^${postgres_db}_(prev|undone)_[0-9]{8}T[0-9]{6}Z$ ]] || die "NAME must be ${postgres_db}_prev_<id> or ${postgres_db}_undone_<id>"
  confirm "This permanently drops database $name."
  psql_admin "DROP DATABASE \"$name\" WITH (FORCE)" >/dev/null
  say "OK: dropped $name"
}

drain_seconds="${HACKOS_DRAIN_SECONDS:-10}"
[[ "$drain_seconds" =~ ^[0-9]+$ ]] || die "HACKOS_DRAIN_SECONDS must be a number"
assume_yes=false

case "$command" in
  create) create_snapshot ;;
  list) cmd_list "$@" ;;
  status) cmd_status ;;
  verify) cmd_verify "$@" ;;
  restore) cmd_restore "$@" ;;
  undo) cmd_undo "$@" ;;
  unlock) cmd_unlock "$@" ;;
  drop-prev) cmd_drop_prev "$@" ;;
esac
