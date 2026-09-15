# Database schema

[`apps/api/db/schema.dbml`](../apps/api/db/schema.dbml) is the generated,
human-facing ERD for the current public PostgreSQL schema. Paste it into
[dbdiagram.io](https://dbdiagram.io/) to inspect the tables and relationships.

The snapshot is not an executable migration and is not the schema source of
truth. SQL migrations in [`apps/api/db/migrations/`](../apps/api/db/migrations/)
remain authoritative because they preserve the forward history and data
backfills. The ERD includes tables, public views, enums, primary/unique
constraints, and foreign-key relationships. It omits `_migrations`, functions,
triggers, check constraints, and implementation-only index details; those are
still visible in the SQL migrations.

## Clean production bootstrap

The production baseline is deliberately the immutable migration ledger, not a
second hand-maintained SQL dump. On an empty PostgreSQL database, apply the
ledger from `0001_initial.sql` through the newest migration with `pnpm migrate`.
The H54 and H8 compatibility branches self-select from the ledger; a clean
database never runs the historical-only `0747` normalizer. The final
`0823_clean_production_schema.sql` removes the rollout-only
`applications.type` and `manual_attendee_roles` objects. `applications.active`
was already removed by `0207_remove_application_active.sql`.

This preserves checksum-verifiable production history for deployed databases
while giving every new production database one reproducible, final schema.
Do not use a staging database as a bootstrap source.

To refresh the human-facing artifact, use a disposable database created from
that path:

```sh
pnpm infra:up
pnpm migrate
pnpm schema:dump
```

`pnpm --filter @hackos/api test` creates an empty database, applies this exact
path, and compares its generated DBML byte-for-byte with the checked-in file.
`pnpm schema:check` performs the same comparison for the currently configured
database. It is a release gate, not a migration command.

Do not generate the snapshot from a production database when a clean migrated
database is available. The schema dump contains no application data, but using
a disposable database keeps the command safe and makes the result reproducible.

### Disposable staging reset (human approval required)

Staging data is not a production compatibility requirement. Resetting staging
destroys all staging data, so the release/DB owner must approve the exact
database target and confirm a backup before an operator drops and recreates it.
After that approved reset, run `pnpm migrate` followed by `pnpm schema:check`.
Never reset a production database to establish this baseline; production
deployments advance through the immutable ledger.

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
the known checksums for those historical files plus pre-squash `0730` (an
all-zero marker is accepted only for a ledger that predates checksums). It
skips the squashed file for that history and applies
`0747_h54_legacy_chain_compatibility.sql` in the same transactional runner,
preserving fixed anonymous fields as dynamic rows and keying any raw scanner
tombstones with `BETTER_AUTH_SECRET`. Fresh/current schemas skip this
compatibility-only file. Unknown ledger names or historical checksums, missing
secrets for raw credentials, and unresolved active-badge collisions still fail
closed. Applied migration names and checksums remain immutable after
deployment.
