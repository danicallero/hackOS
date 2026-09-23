# Database schema

[`apps/api/db/schema.dbml`](../apps/api/db/schema.dbml) is the generated,
human-facing ERD for the current public PostgreSQL schema. Paste it into
[dbdiagram.io](https://dbdiagram.io/) to inspect tables and relationships.

[`apps/api/db/migrations/0001_hackos_baseline.sql`](../apps/api/db/migrations/0001_hackos_baseline.sql)
is the executable, consolidated starting database. It is organized into
product-domain sections and includes the final DDL, database functions,
triggers, indexes, constraints, extensions, and required default configuration
and role seeds. It does not contain staging or application data.

## Relational model

| Area | Core relationships and boundaries |
| --- | --- |
| Identity and authorization | `users` have many `user_roles`; `roles` have tri-state `role_capabilities`, grants and seed defaults. Sessions/accounts/verifications belong to a user. |
| Applications | An `application` owns immutable `application_form_versions`; each `application_response` belongs to a user and version. Reviews and role grants derive from responses. |
| Sponsors and challenges | An `enterprise` has sponsors, challenges, judge rosters and queue groups. A queue group cannot cross enterprise boundaries. |
| Projects and judging | `repos` collect submissions and Devpost records. Queue entries are unique per repo/challenge and connect to rooms, history, judging sessions and reviews. Rooms use their numeric primary key as the stable internal identifier; their editable human-facing fields are name and location. |
| Event operations | Tickets, badges, wallet passes, check-ins, time logs, meals and activities connect to the participant or the anonymous-retention boundary. |
| Content and communication | Schedule, announcements, recipients, notification preferences, push tokens and durable outbox rows are isolated from operational writes. |
| Privacy, audit and reporting | Account-removal state, anonymous participants, revoked scanner credentials, `audit_log`, idempotency keys and statistics ACLs provide the durable control plane. |

The generated ERD contains tables, views, enums, primary/unique constraints and
foreign keys. The SQL baseline also contains check constraints, functions,
triggers and indexes that do not fit in DBML.

## New database and future migrations

On an empty database, run:

```sh
pnpm migrate
pnpm schema:check
```

The resulting ledger contains the baseline plus any forward migrations in
`apps/api/db/migrations/` (for example, `0405_remove_room_slug.sql`). The
runner validates every applied filename and SHA-256 checksum before later work
runs. The baseline is immutable once deployed; all later schema changes are
new, forward-only `NNNN_name.sql` files in `apps/api/db/migrations/`.

`pnpm --filter @hackos/api test` rebuilds an empty database from the active
migration directory and compares its generated DBML byte-for-byte with the
checked-in ERD. `pnpm schema:check` performs the same comparison against the
configured database.

## Staging reset and deployment

This repository intentionally has a new migration lineage. Do not deploy it
against a database with the retired `_migrations` ledger. For each staging
database, drop and recreate the database, deploy this revision, then run
`pnpm migrate` followed by `pnpm schema:check`.

The retired pre-production SQL files remain under
[`apps/api/db/migration-history/`](../apps/api/db/migration-history/) for
traceability only; the runner never reads that directory.
