# Database schema

[`apps/api/db/schema.dbml`](../apps/api/db/schema.dbml) is the generated,
human-facing ERD for the current public PostgreSQL schema. Paste it into
[dbdiagram.io](https://dbdiagram.io/) to inspect the tables and relationships.

The snapshot is not an executable migration and is not the schema source of
truth. SQL migrations in [`apps/api/db/migrations/`](../apps/api/db/migrations/)
remain authoritative because they preserve the forward history and data
backfills. The ERD omits `_migrations`, functions, triggers, and implementation-
only index details; those are still visible in the SQL migrations.

Refresh it against a clean local database after applying migrations:

```sh
pnpm infra:up
pnpm migrate
pnpm schema:dump
```

Do not generate the snapshot from a production database when a clean migrated
database is available. The schema dump contains no application data, but using
a disposable database keeps the command safe and makes the result reproducible.

## Migration identity

Every active migration has a unique four-digit sequence prefix. The runner
stores a SHA-256 checksum in `_migrations` and fails before applying later
migrations if an applied file changes. Existing databases created before
checksums were introduced are backfilled once, under the migration advisory
lock; future edits then fail loudly.

The 07xx files that had duplicate prefixes were renumbered without changing
their SQL. The runner recognizes their previous filenames as aliases, so a
database that already applied them does not execute them again.

H54 is currently represented by one fresh-schema baseline,
`0730_account_deletion_anonymization.sql`; the development-only `0731`–`0746`
files are intentionally absent. Before deploying to a populated database,
inspect `_migrations` for a pre-squash H54 `0730` record/checksum or any of the
removed `0731`–`0746` names. The current runner has no aliases for those H54
records, so stop and prepare a separately reviewed additive upgrade path if any
are present; do not apply this fresh baseline as a substitute. Applied
migration names and checksums remain immutable after deployment.
