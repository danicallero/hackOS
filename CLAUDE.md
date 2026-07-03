# hackOS

Hackathon management platform: one API replacing four legacy tools. **Functional
source of truth: `plan/historias-hackos.md`** (user stories H1-H55). If docs
conflict, that file wins. Hard invariants live in `plan/07-datos-relevantes-ers.md`.

## Layout

- `apps/api` — Fastify 5 + BullMQ + Postgres + Valkey. The only app so far
  (web/mobile come later; **no UI work now**).
- `packages/shared` — capability catalogue (`capabilities.ts`) and SSE event
  contract (`events.ts`). Add new capability/event names THERE, never inline.
- `packages/typescript-config` — shared tsconfig base.
- `plan/` — normative docs. Read-only.

## Non-negotiable conventions

1. **Traceability**: every commit/PR message and non-obvious code comment
   references its story (`H29`), e.g. `feat(queue): call_next transition (H29, H30)`.
2. **Permissions by capability, never role** (H8): guard routes with
   `requireCapability(CAPABILITIES.X)` from `src/lib/capabilities.ts`.
3. **Audit sensitive mutations** (H53): call `audit(client, …)` from
   `src/lib/audit.ts` inside the SAME transaction as the domain write.
4. **Explicit business errors**: throw `AppError` subclasses
   (`src/lib/errors.ts`). Never swallow errors or return silent success.
5. **Idempotency on critical mutations** (scanners, queue transitions,
   confirmations): add `preHandler: idempotencyGuard`.
6. **Concurrency**: state transitions use `withTransaction` +
   `SELECT … FOR UPDATE`; exactly one winner per transition (plan/07 §2).
7. **Realtime**: emit via `broadcast(topic, EVENT, data)` from `src/lib/sse.ts`
   using names from `@hackos/shared/events`. One history row + one broadcast
   per queue action (plan/07 invariant 5).
8. **Raw SQL** with parameterized queries (`pg`). No ORM. Schema changes via
   SQL migrations only.

## Database & migrations

- Migrations: `apps/api/db/migrations/NNNN_name.sql`, applied lexicographically
  by `pnpm migrate` (advisory-locked, one transaction per file).
- **Numbering bands per workstream** (avoids parallel collisions):
  `0001-0099` foundation · `01xx` identity · `02xx` applications ·
  `03xx` projects/devpost · `04xx` queue/judging · `05xx` logistics ·
  `06xx` notifications · `07xx` sponsors/content.
- Document schema deltas vs `plan/schema-boceto.dbml` with a `DELTA(Hxx)`
  comment in the migration.
- Tables with `updated_at` need the `set_updated_at` trigger (see 0001).

## Module pattern

Each domain = a directory `apps/api/src/modules/<domain>/` exporting
`register<Domain>Module(app)` (routes + workers), registered with ONE line in
`src/modules/index.ts` (keep alphabetical). Workers: `registerWorker(name, processor)`
from `src/lib/queues.ts` at import time; never instantiate BullMQ directly.

Auth context: `req.userId` (null if anonymous) is decorated by
`src/plugins/auth-context.ts`. The identity module plugs Better Auth in via
`setUserIdResolver`; everyone else just reads `req.userId`.

## Local dev & tests

```sh
pnpm infra:up          # docker compose: postgres on HOST PORT 5433, valkey:6379, minio:9000, mailpit:8025
pnpm migrate           # apply migrations to dev DB
pnpm --filter @hackos/api test   # vitest; wipes + remigrates hackos_test, then runs suites serially
pnpm dev               # API on :3000 (tsx watch)
pnpm lint              # biome
```

- Tests are **integration-first** against real Postgres/Valkey (no mocks of
  the DB). Use `test/helpers.ts`: `truncateAll()`, `createUser()`,
  `createUserWithCapabilities([...])`, `asUser(id)` header for `app.inject()`.
- `x-test-user-id` header authenticates requests in NODE_ENV=test only.
- Import app code lazily (inside tests) or after `test/setup.ts` ran.
- Every story you implement needs tests for: happy path, business-error path,
  and concurrency/idempotency where the story mentions it.

## Deployment (keep working)

`apps/api/Dockerfile` builds from the repo root; `docker compose --profile full up`
must keep working. Workers run inline in dev (`WORKERS_INLINE`), as a separate
container (`node dist/worker.js`) in production. Don't hardcode
`localhost` — everything configurable comes from `src/config.ts` (zod-validated env).
