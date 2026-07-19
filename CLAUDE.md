# hackOS

Hackathon management platform: one API replacing four legacy tools. **Functional
source of truth: `plan/historias-hackos.md`** (user stories H1-H55). If docs
conflict, that file wins. Hard invariants live in `plan/07-datos-relevantes-ers.md`.

## Layout

- `apps/api` — Fastify 5 + BullMQ + Postgres + Valkey.
- `apps/web` — Next.js 16 frontend. Its own conventions live in `apps/web/README.md`;
  read that before touching it.
- `apps/mobile` — Expo Router (React Native) app; `docs/mobile.md` covers what's
  built, `docs/mobile-release.md` the build/store runbook.
- `packages/shared` — capability catalogue (`capabilities.ts`) and SSE event
  contract (`events.ts`). Add new capability/event names THERE, never inline.
- `packages/typescript-config` — shared tsconfig base.
- `plan/` — normative docs. Read-only.
- `docs/` — living docs on how the current code implements the stories in
  `plan/`. Keep in sync with code — see **Documentation** below.
- `deploy/` — Dokploy / docker-compose deployment; `deploy/README.md` is
  normative for anything env-var or infrastructure related.

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
pnpm --filter @hackos/api test test/queue/…      # single file/dir (any vitest filter arg)
pnpm dev               # API on :3000 + web on :3001 (pnpm dev:api / dev:web for one)
pnpm lint              # biome + i18n copy check (scripts/check-copy.mjs)
pnpm --filter @hackos/api seed               # seed dev data
pnpm --filter @hackos/api superadmin:create  # bootstrap first admin
```

- Tests are **integration-first** against real Postgres/Valkey (no mocks of
  the DB). Use `test/helpers.ts`: `truncateAll()`, `createUser()`,
  `createUserWithCapabilities([...])`, `asUser(id)` header for `app.inject()`.
- `x-test-user-id` header authenticates requests in NODE_ENV=test only.
- Import app code lazily (inside tests) or after `test/setup.ts` ran.
- Every story you implement needs tests for: happy path, business-error path,
  and concurrency/idempotency where the story mentions it.
- User-facing copy is trilingual: every i18n entry (`apps/web/src/lib/i18n.ts`,
  `apps/mobile/lib/i18n.tsx`) needs `es`/`gl`/`en`, and copy must not leak story
  IDs (`H29`) or raw capability keys (`queue:admin`) — `pnpm check:copy` enforces this.

## Deployment (keep working)

`apps/api/Dockerfile` builds from the repo root; `docker compose --profile full up`
must keep working. Workers run inline in dev (`WORKERS_INLINE`), as a separate
container (`node dist/worker.js`) in production. Don't hardcode
`localhost` — everything configurable comes from `src/config.ts` (zod-validated env).

## Documentation

Docs are not a side project — a change isn't done until the doc that
describes the thing it touched is still true. There's no separate "update the
docs" pass at the end of a big feature; update the relevant file in the same
commit as the code, the way tests are expected in the same commit.

Concrete triggers — if your change does X, update Y:

| You changed | Update |
|---|---|
| A route's request/response shape or behavior | Its Zod schema's `summary`/`description` (this **is** the API doc — `/documentation` is generated from it, nothing to hand-sync) |
| A new module, or a module's schema/state machine | The relevant file in `docs/` (add a new one if the module has none yet; follow the format in `docs/modules-1-5.md` or `docs/challenges-devpost.md`) |
| A new `docs/*.md` file | Its link in `docs/README.md`'s index |
| `packages/shared/src/capabilities.ts` or `events.ts` | Any doc that enumerates capabilities/events by name (grep before assuming there are none) |
| A `deploy/services/*/docker-compose.yml` env var (added/renamed/removed) | The matching row in `docs/env-vars.md`, `deploy/README.md`'s shared/service-only tables, **and** that service's `dokploy.env.example` (add/rename/remove the `${{environment.VAR}}` line to match) |
| Root-level dev workflow (`pnpm` scripts, ports, infra services) | `README.md` |
| `apps/web` conventions or component library | `apps/web/README.md` |
| Design tokens, container/action hierarchy, accessibility or copy rules (any UI surface) | `docs/DESIGN.md` — the consolidated design/UX rulebook |
| `apps/mobile` screens, scanners, or story coverage | `docs/mobile.md` (build/signing/store steps: `docs/mobile-release.md`) |
| Navigation (`apps/web/src/lib/nav.ts` workspaces, `apps/mobile/lib/tabs.ts` tabs) | `docs/navigation.md`'s workspace/tab mapping |
| Worker registration or tick cadence (`registerWorker`) | `docs/background-workers.md`'s queue table |
| A conflict between `plan/` and any other doc | Nothing in `plan/` — it's read-only and wins by definition. Fix the other doc, or flag the conflict to a human if `plan/` itself looks wrong. |

New routes are not exempt from having real docs: a route registered without an
explicit `description` in its schema shows a visible
`"No description yet — add one to this route's schema."` placeholder in
`/documentation` (see `apps/api/src/app.ts`) — treat that placeholder the same
as a failing lint, not as acceptable output.
