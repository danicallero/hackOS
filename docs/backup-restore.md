# Backups, restore and the maintenance lock (#539)

Operational guide for the S3 backups taken by `deploy/scripts/backup.sh` and
the lock that protects users while a database is replaced. Bucket setup and
variables: `deploy/README.md` § Backups en AWS S3 and `docs/env-vars.md`.

## Maintenance lock

While a restore runs, the host holds a lock file, `state.json`, in
`$HACKOS_DATA_DIR/maintenance` (mounted read-only into `api` as
`MAINTENANCE_DIR`). It lives outside PostgreSQL on purpose: the database is
the thing being replaced.

```json
{ "phase": "restoring", "restoreId": "…", "startedAt": "…", "etaAt": "…" }
```

Phases: `draining` → `restoring` → `verifying`, or `failed`. A missing file
means no maintenance; an unreadable file blocks traffic (fail closed).

| Piece | Behaviour |
|---|---|
| API gate (`plugins/maintenance.ts`) | Every route except `/healthz`, `/readyz`, `/metrics` and `GET /api/public/maintenance` answers `503 maintenance_in_progress` with `Retry-After: 30` and `details.phase`. Runs before auth context, so no session query touches the database. |
| `GET /api/public/maintenance` | `{ "active": false }` or `{ "active": true, "phase", "restoreId", "startedAt", "etaAt" }`. Reads the file only (cached 1 s), never the database. |
| Web | `apiFetch` arms `MaintenanceGate` on the first `503 maintenance_in_progress`; it replaces the app with a waiting screen, polls the status endpoint every 10 s and reloads when the lock is gone. |
| Mobile | `api.ts` arms a blocking `MaintenanceScreen`, which polls the same endpoint and resumes the app by itself. |

A `failed` phase keeps the lock and the screens say an administrator is
needed; nothing reopens a half-restored database automatically.

## Commands

All of them are `backup.sh <environment> <command>` on the host
(`/opt/hackos/backup.sh`), and the same set is in the operator console:
`services.sh <environment> backups …` or **Backups and restore** in
`services.sh <environment> shell`.

| Command | What it does |
|---|---|
| `create` (default) | Dump → `snapshots/<id>/postgres.dump`, incremental MinIO mirror → `minio/`, manifest last (image, migration head, dump size and ETag). Deploys call it before `migrate`. |
| `list` | Recent snapshots with image, migration head and dump size; an `incomplete` row has no manifest and is never restored. |
| `status` | Latest snapshot age (exit 1 when older than the schedule allows: 26 h daily, 8 d weekly, 32 d monthly), the maintenance lock, and leftover databases. Safe to run any time; it takes no lock. |
| `verify [id\|latest]` | Restores into a scratch database, checks migration head, table count, dump size and ETag, drops it and prints the elapsed time. Live data and users are untouched. |
| `restore [id\|latest]` | See below. Asks to type `restore <environment>`; `--yes` skips it, `--no-pre-backup` skips step 3. |
| `undo` | Swaps back to the database the last restore replaced, with the same lock. |
| `unlock` | Clears a lock left by a failed restore, after you checked the database. |
| `drop-prev NAME` | Drops a `*_prev_*` or `*_undone_*` database to free disk. |

## Restore flow

1. Restore the snapshot into `<db>_incoming` and verify it, with users still online.
2. Write the lock (`draining`), wait `HACKOS_DRAIN_SECONDS` (10) and stop the worker.
3. Take a pre-restore snapshot of the exact live state, so the rollback can itself be rolled back.
4. `restoring`: forbid connections, terminate sessions, rename `<db>` → `<db>_prev_<id>` and `<db>_incoming` → `<db>`.
5. Mirror the snapshot's MinIO objects back (nothing is deleted), flush Valkey, recreate `api` and `worker` (the one-shot `migrate` runs forward on the way), and write an audit row (`database.restored`) in the restored database.
6. Clear the lock.

The previous database is kept as `<db>_prev_<id>` until you `drop-prev` it.

Failure handling: before step 4 nothing live changed, so the script reopens
by itself and drops the scratch database. After the swap the lock stays on
(`failed`) and the script prints the two ways out: `undo` or `unlock`.

The restore runs the **currently deployed** images and migrates forward. If the
snapshot was taken on another image the script says so; align with
`services.sh <environment> deploy sha-<commit> --both` afterwards.

## Locks

`backup.sh` shares `/opt/hackos/.deploy.lock` with deploys, so a restore,
a backup and a deploy never overlap (a timer backup that finds it busy just
skips). `ALLOW_CONNECTIONS false` plus the API gate keep stray connections
out during the swap.

## Drill

`deploy/qualification/backup-restore-drill.sh` rehearses the whole cycle (backup,
verify, restore with the lock observed, undo, a corrupt snapshot failing before
the swap, unlock) against throwaway PostgreSQL, Valkey and MinIO containers,
with a second MinIO standing in for S3. CI runs it monthly and on changes to
the script (`.github/workflows/backup-restore-drill.yml`). Run `backup.sh
<environment> verify latest` on the real host before an event; it prints the
restore time to record as the measured RTO on #539.

## Cost notes

Dumps are compressed, the MinIO mirror is incremental, and the bucket expires
snapshots after 35 days, so storage stays at a few GB-months. No Object Lock,
KMS or cross-region replication (all billed per request or per GB). Stale-backup
alerting: `status` exits non-zero when the newest snapshot is too old, so any
cron or monitor that can run a command can page on it; wiring it into Grafana is
not done yet.
