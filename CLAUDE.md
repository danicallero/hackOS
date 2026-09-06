# hackOS

> **Agents:** `AGENTS.md` is the entry point — it tells you what to read before
> writing code. This file contains the conventions themselves.

Hackathon management platform: one API replacing four legacy tools. **Functional
source of truth: `plan/historias-hackos.md`** (user stories H1-H59). If docs
conflict, that file wins. Hard invariants live in `plan/07-datos-relevantes-ers.md`.

## Layout

- `apps/api` — Fastify 5 + BullMQ + Postgres + Valkey.
- `apps/web` — Next.js 16; conventions in `apps/web/README.md`.
- `apps/mobile` — Expo Router; `docs/mobile.md`, `docs/mobile-release.md`.
- `packages/shared` — `capabilities.ts` + `events.ts`. Add new names THERE, never inline.
- `plan/` — normative docs. Read-only.
- `docs/` — living implementation docs. Keep in sync with code.
- `deploy/` — Dokploy / docker-compose; `deploy/README.md` is normative.

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
9. **UI copy is minimal and purposeful** (any surface: web, mobile, TV). Don't
   add labels, subtitles, descriptions, helper text, or tooltips that restate
   what a heading, label, icon, or control already makes obvious — headings
   and controls should speak for themselves. Keep copy only for risk,
   consequence, policy, an unusual interaction, or genuinely unfamiliar domain
   rules. Don't reach for `CardDescription`/`FormDescription`/
   `DialogDescription`/tooltips just because the component offers a slot for
   them. When uncertain, prefer less copy. Full writing rules and calibration
   examples: `docs/DESIGN.md` §10 and §15.

## Database & migrations

- Migrations: `apps/api/db/migrations/NNNN_name.sql`, applied lexicographically
  by `pnpm migrate` (advisory-locked, one transaction per file).
- Every active migration has a unique four-digit sequence prefix and is
  immutable after application; `_migrations` stores a SHA-256 checksum and the
  runner fails before later work when an applied file changes. Use a new
  migration for a correction.
- **Numbering bands per workstream** (avoids parallel collisions):
  `0001-0099` foundation · `01xx` identity · `02xx` applications ·
  `03xx` projects/devpost · `04xx` queue/judging · `05xx` logistics ·
  `06xx` notifications · `07xx` sponsors/content · `08xx` roles/permissions
  (H8 rework replacing the capability-group model — see
  `apps/api/src/lib/capabilities.ts`).
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

See root `README.md` for the full command reference. Key points for agents:

- Tests are **integration-first** against real Postgres/Valkey (no mocks).
  Use `test/helpers.ts`: `truncateAll()`, `createUser()`,
  `createUserWithCapabilities([...])`, `asUser(id)` for `app.inject()`.
- `x-test-user-id` header authenticates in NODE_ENV=test only.
- Import app code lazily (inside tests) or after `test/setup.ts` ran.
- Every story needs tests: happy path, business-error path, and
  concurrency/idempotency where the story mentions it.
- Trilingual copy: every i18n entry needs `es`/`gl`/`en`. `pnpm check:copy`
  enforces no leaked story IDs or capability keys.

## Deployment (keep working)

`apps/api/Dockerfile` builds from the repo root; `docker compose --profile full up`
must keep working. Workers run inline in dev (`WORKERS_INLINE`), as a separate
container (`node dist/worker.js`) in production. Don't hardcode
`localhost` — everything configurable comes from `src/config.ts` (zod-validated env).

## Pull requests and merges

- **Opening a PR never authorizes merging it.** Treat every newly opened PR as
  a handoff for human review and leave it open unless the user's current
  message explicitly instructs you to merge or enable auto-merge.
- Merge permission does not carry over from earlier messages, broad ownership
  language, a request to "finish" the issue, green CI, or repository merge
  conventions. If the current message only asks you to open/create/prepare a
  PR, stop after opening it and report the URL and check status.
- Never enable auto-merge unless the user's current message explicitly requests
  auto-merge. When that same-message authorization exists, use a merge commit
  (`gh pr merge --merge`), never squash.

## Documentation

Docs are not a side project — a change isn't done until the doc that
describes the thing it touched is still true. There's no separate "update the
docs" pass at the end of a big feature; update the relevant file in the same
commit as the code, the way tests are expected in the same commit.

Concrete triggers — if your change does X, update Y:

| You changed | Update |
|---|---|
| A route's request/response shape or behavior | Its Zod schema's `summary`/`description` (this **is** the API doc — `/documentation` is generated from it, nothing to hand-sync) |
| A new module, or a module's schema/state machine | The relevant file in `docs/` (add a new one if the module has none yet; follow the format in `docs/api-reference.md` or `docs/challenges-devpost.md`) |
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

A change to what a screen looks like is not done until reviewers can see it:
run the app and post screenshots of the changed states in a PR comment
(`docs/ui-testing.md` § Screenshots on UI PRs). Passing component tests do not
substitute — they assert behaviour, not spacing or alignment.

New routes are not exempt from having real docs: a route registered without an
explicit `description` in its schema shows a visible
`"No description yet — add one to this route's schema."` placeholder in
`/documentation` (see `apps/api/src/app.ts`) — treat that placeholder the same
as a failing lint, not as acceptable output.
