# hackOS — architecture docs

Living documentation for how the current code implements the product. The
normative functional source of truth remains `plan/historias-hackos.md`
(stories H1–H55) and `plan/07-datos-relevantes-ers.md` (hard invariants);
this folder explains *how* the code implements the relevant slices. If a doc
here disagrees with `plan/`, the plan wins and the doc (or the code) is the bug.

Reading order for a new agent/contributor: root [`README.md`](../README.md)
(setup) → `CLAUDE.md` (conventions every change must follow) → the
**one-paragraph orientation** below → whichever module doc matches your task.

## Index

Architecture & modules:

- [Module summaries (M1–M5)](./modules-1-5.md) — schemas, hooks, UI layouts and
  state transitions touched by each module, with the corrections made where the
  original brief assumed something the schema contradicts.
- [Background processing & workers](./background-workers.md) — the BullMQ +
  Postgres worker subsystem: job flows, queue structure, retries, concurrency,
  the failure/dead-letter model, and (critically) the **sync-vs-async** event
  map that shows which module work runs in the request and which is handed off.
- [Challenges & Devpost projects](./challenges-devpost.md) — the `challenges`
  and `projects` modules and the Devpost intake pipeline.
- [Event config & the Apple Wallet pass](./event-config-wallet.md) — the
  `event_config` singleton (identity, doors-open vs hacking window, venue) and
  how the Wallet pass renders from it (field visibility, captions, back fields).

Frontend (web & mobile):

- [Design system, UI & UX](./DESIGN.md) — the consolidated design rulebook,
  indexed and summarized per section: principles, tokens (with intent and
  boundaries), container and component decision logic, page/action hierarchy,
  accessibility, the domain state models that must stay visually distinct,
  the copy rules `pnpm check:copy` enforces, web- and mobile-specific
  constraints, and an explicit don'ts list. Read before building or styling
  any screen; `apps/web/README.md` covers the component library itself.
- [Navigation: capability-based workspaces](./navigation.md) — the personal
  area + additive work-workspace model on web, and the one-action mobile scan
  entry, with the full capability-to-workspace mapping.
- [Mobile app](./mobile.md) — the Expo Router app (`apps/mobile`): Better Auth
  Expo integration, capability-driven tabs, offline scanners, and participant
  screens, with the per-story status registry.
- [Mobile development & store release](./mobile-release.md) — local device
  setup, prebuild/CNG, EAS profiles and environments, local/cloud compilation,
  signing and push credentials, icons/store artwork, submission, privacy, and
  release checklists.

Deployment:

- [Environment variables per service](./env-vars.md) — for each container in
  an isolated deploy (`deploy/services/*`), exactly which env vars it needs and
  whether they're read at container start or baked in at build time.

See also the root [`README.md`](../README.md) for local dev setup, the API's
own `/documentation` (Swagger UI, generated from route schemas — not a file in
this folder), [`apps/web/README.md`](../apps/web/README.md) for web frontend
conventions and the component library, and
[`deploy/README.md`](../deploy/README.md) for the full deployment story
(networking, secrets, Dokploy modes).

## One-paragraph orientation

hackOS is a single Fastify 5 API (`apps/api`) plus a Next.js 16 web app
(`apps/web`) and an Expo Router mobile app (`apps/mobile`), backed by Postgres
and Valkey (Redis-compatible), with `packages/shared` holding the two contracts
every app imports: the capability catalogue and the SSE event names.
Permissions are by **capability, never role** (`requireCapability(...)`; the
`role` string is display-only). Sensitive mutations are **audited in the same
transaction** as the write (`audit(...)`). State transitions use
`withTransaction` + `SELECT … FOR UPDATE` so exactly one writer wins. Realtime
goes out over SSE; deferred work goes through **repeatable BullMQ "tick" jobs
that drain database-backed queues** — the durability and retry story lives in
the DB rows, not in BullMQ (see the worker doc). User-facing copy is
trilingual (es/gl/en) via per-app i18n dictionaries.

## Corrections the brief needed (grounded against the schema)

| Brief assumption | Reality | What we did |
| --- | --- | --- |
| Map a `DNA` question to a `User.DNA` field | No such field; `DNA` was a typo for **`DNI`** (which exists on `users`) | Mirror a `dni`-keyed answer → `users.dni` |
| `email` is the primary key needing cascading FK updates | `users.id` is the PK; `email` is a plain `UNIQUE` column; credential login keys on `user_id` | Primary-email change is a single-column update + uniqueness check + audit |
| "Delete account" is failing | Hard-delete works for fresh accounts and *intentionally* 409s for accounts with history (H54 says anonymize) | Added the H54 **anonymize** path the 409 already pointed to |
| Remove the "check-ins" concept | Check-in vs door-presence is modelled deliberately (H23/H24) | Folded check-ins into a unified **Presence** view; a badge assignment is just the first door scan |
| Assign a "Batch" to a user | No `batch` column; the thing assigned on entry (and re-issued on loss) is the **badge** (`badge_id` + history) | Interpreted "Batch" as **badge**; assignment control deferred (needs guard/schema care) |
