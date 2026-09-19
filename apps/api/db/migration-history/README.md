# Retired pre-production migration history

These files record the development path that led to the consolidated starting
schema in `../migrations/0001_hackos_baseline.sql`. They are intentionally not
read by `pnpm migrate` and must never be applied to a new database.

The staging-only reset replaced this lineage. Keep the files for historical
traceability; create all future changes as forward-only migrations in
`../migrations/`.
