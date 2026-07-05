# hackOS — architecture docs

Living documentation for the changes delivered across Modules 1–5 and the
background-processing subsystem (Module 6). The normative functional source of
truth remains `plan/historias-hackos.md` (stories H1–H55) and
`plan/07-datos-relevantes-ers.md` (hard invariants); this folder explains *how*
the current code implements the relevant slices.

- [Module summaries (M1–M5)](./modules-1-5.md) — schemas, hooks, UI layouts and
  state transitions touched by each module, with the corrections made where the
  original brief assumed something the schema contradicts.
- [Background processing & workers](./background-workers.md) — the BullMQ +
  Postgres worker subsystem: job flows, queue structure, retries, concurrency,
  the failure/dead-letter model, and (critically) the **sync-vs-async** event
  map that shows which module work runs in the request and which is handed off.

## One-paragraph orientation

hackOS is a single Fastify 5 API (`apps/api`) plus a Next.js 16 web app
(`apps/web`), backed by Postgres and Valkey (Redis-compatible). Permissions are
by **capability, never role** (`requireCapability(...)`). Sensitive mutations are
**audited in the same transaction** as the write (`audit(...)`). State
transitions use `withTransaction` + `SELECT … FOR UPDATE` so exactly one writer
wins. Realtime goes out over SSE; deferred work goes through **repeatable BullMQ
"tick" jobs that drain database-backed queues** — the durability and retry story
lives in the DB rows, not in BullMQ (see the worker doc).

## Corrections the brief needed (grounded against the schema)

| Brief assumption | Reality | What we did |
| --- | --- | --- |
| Map a `DNA` question to a `User.DNA` field | No such field; `DNA` was a typo for **`DNI`** (which exists on `users`) | Mirror a `dni`-keyed answer → `users.dni` |
| `email` is the primary key needing cascading FK updates | `users.id` is the PK; `email` is a plain `UNIQUE` column; credential login keys on `user_id` | Primary-email change is a single-column update + uniqueness check + audit |
| "Delete account" is failing | Hard-delete works for fresh accounts and *intentionally* 409s for accounts with history (H54 says anonymize) | Added the H54 **anonymize** path the 409 already pointed to |
| Remove the "check-ins" concept | Check-in vs door-presence is modelled deliberately (H23/H24) | Folded check-ins into a unified **Presence** view; a badge assignment is just the first door scan |
| Assign a "Batch" to a user | No `batch` column; the thing assigned on entry (and re-issued on loss) is the **badge** (`badge_id` + history) | Interpreted "Batch" as **badge**; assignment control deferred (needs guard/schema care) |
