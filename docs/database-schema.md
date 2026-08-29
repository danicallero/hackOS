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

H54 is represented by the squashed
`0730_account_deletion_anonymization.sql` for a fresh schema and a latest-main
schema whose ledger ends at `0725`. On the populated path it converts legacy
`anonymized_at` rows, snapshots existing forms/responses, and retires legacy
scanner credentials using the deployment `BETTER_AUTH_SECRET` before
installing the final constraints. It removes detached verification rows that
cannot belong to an active account, captures Devpost-only project roots, and
aborts before commit when a historical badge is assigned to an active user.

The runner also recognizes the deleted development-only `0731`–`0746` names and
known pre-squash `0730` checksums. It skips the squashed file for that history
and applies `0747_h54_legacy_chain_compatibility.sql` in the same transactional
runner, preserving fixed anonymous fields as dynamic rows and keying any raw
scanner tombstones with `BETTER_AUTH_SECRET`. Fresh/current schemas skip this
compatibility-only file. Unknown ledger names, malformed historical checksums,
missing secrets for raw credentials, and unresolved active-badge collisions
still fail closed. Applied migration names and checksums remain immutable after
deployment.
