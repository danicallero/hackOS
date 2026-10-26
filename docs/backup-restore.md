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
