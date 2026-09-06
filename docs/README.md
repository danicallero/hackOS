# hackOS — architecture docs

Living documentation for how the current code implements the product. The
normative functional source of truth remains `plan/historias-hackos.md`
(stories H1–H59) and `plan/07-datos-relevantes-ers.md` (hard invariants);
this folder explains *how* the code implements the relevant slices. If a doc
here disagrees with `plan/`, the plan wins and the doc (or the code) is the bug.

Reading order for a new agent/contributor: [`AGENTS.md`](../AGENTS.md)
(entry point, prescribed reads) → `CLAUDE.md` (conventions every change must
follow) → root [`README.md`](../README.md) (setup) → the **one-paragraph
orientation** below → whichever module doc matches your task.

**One-paragraph orientation.** hackOS is a Fastify API (`apps/api`, raw SQL,
no ORM) plus a Next.js web app and an Expo mobile app, all reading/writing the
same Postgres database and sharing capability names and realtime event names
from `packages/shared`. Every domain — applications, projects, queue,
logistics, notifications, identity, sponsors, challenges, event, exports —
lives in its own `apps/api/src/modules/<domain>/` directory and follows the
same conventions: capability-based authorization (never role checks),
audited mutations in the same transaction as the write, `SELECT ... FOR
UPDATE` + idempotency keys on state transitions, and SSE realtime fan-out
through Valkey. [`api-reference.md`](./api-reference.md) is the map of what
each module owns and where those conventions live in code; the rest of this
folder goes deeper on one system, module, or client at a time.

## Index

Architecture & modules:

- [API reference — module and convention overview](./api-reference.md) — what
  each `apps/api` module owns, and the conventions that hold across all of
  them: capability-based authorization, route-access-policy kinds, the
  `AppError` shape, audit, concurrency/idempotency, realtime, and background
  work. Start here for "what does the API do and how is it organized";
  `/documentation` (Swagger UI, generated from route schemas) is the
  route-by-route reference this page deliberately doesn't duplicate.
- [Architecture & infrastructure](./architecture.md) — the system view: the six
  services and their stacks, the two-network security boundary, state ownership
  (Postgres truth vs. ephemeral Valkey), realtime SSE fan-out, the one-image
  model, scalability (more workers, the Postgres ceiling, multi-instance
  tenancy), the reasoning behind the big decisions, and the small-vs-real
  deployment profiles. Start here for the whole-system picture;
  `deploy/README.md` is the operational runbook.
- [Database schema](./database-schema.md) — the generated DBML ERD for the
  current post-migration schema, plus the migration identity/checksum rules.
- [Background processing & workers](./background-workers.md) — the BullMQ +
  Postgres worker subsystem: job flows, queue structure, retries, concurrency,
  the failure/dead-letter model, and (critically) the **sync-vs-async** event
  map that shows which module work runs in the request and which is handed off.
- [Challenges & Devpost projects](./challenges-devpost.md) — the `challenges`
  and `projects` modules and the Devpost intake pipeline.
- [Queue groups (H46)](./queue-groups.md) — the enterprise-scoped grouping
  layer between challenges and the rooms/queues that judge them: why
  `queue_entries.challenge_id` stays untouched, the two database-enforced
  invariants (a group never spans enterprises; every challenge has exactly one
  group), the 1:1 backfill, and the admin merge that turns several of an
  enterprise's challenges into one shared judging queue with one form.
- [Queue operator console](./queue-operator.md) — the live arrival board for
  queue operators: shared-queue deduplication, local team search, room
  destinations, capability-gated actions, and the integration boundary with
  queue configuration.
- [Event config & the Apple Wallet pass](./event-config-wallet.md) — the
  `event_config` singleton (identity, doors-open vs hacking window, venue) and
  how the Wallet pass renders from it (field visibility, captions, back fields),
  plus the session-less scoped-token path from the acceptance email.
- [Notifications & announcements](./notifications.md) — the announcement
  model (screen placement vs. delivery vs. targeting), the notify-only vs.
  screen-window distinction, audience/recipient targeting and per-announcement
  channel candidates, and the generic notify/outbox/dispatch pipeline (H50,
  H51, H52, H53) every other module plugs into.
- [Schedule categories (activity kinds)](./schedule-categories.md) — the one
  registry every schedule/activity category comes from, how to add or retire
  one, and the four guardrails (typed label keys, the web icon map, the mobile
  Android-symbol map, `pnpm check:copy`) that keep the API, web and mobile from
  drifting apart.
- [TV screens](./tv-screens.md) — what the venue's screens show and why: the
  override / timetable / default precedence, the combined live screen and its
  payload, slot rotation, venue Wi-Fi, and how each mode adapts to any screen
  size or aspect ratio.
- [Generated API route-policy ledger](./access-control-route-ledger.md) — the
  complete sorted runtime declaration inventory and public/token allowlist
  snapshot; regenerate it with `pnpm --filter @hackos/api route-policy:audit`.
- [Rate limiting](./rate-limiting.md) — the Valkey-backed distributed limiter
  shared by Better Auth's own paths and this app's routes, the endpoint-class
  limits table, fail-open behavior and its metrics, and the trusted-proxy
  requirement it depends on.
- [Account deletion and irreversible anonymization](./account-deletion.md) —
  the H54 data-flow inventory, authoritative retention boundary, anonymous
  audit-subject design, operational/dietary retention, venue-presence
  calculation, mobile/web flows, offline-cache behavior, concurrency controls,
  App Store review risks, assumptions, and test matrix.
- [Synthetic reviewer fixtures](./reviewer-fixtures.md) — the isolated account
  generation workflow, marked participant queue, synthetic-operator scope,
  credential-use signal, and deployment assumptions.

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
- [RouterTabs component](./router-tabs.md) — the reusable Expo Router tab shell:
  public API, Liquid Glass and opaque fallback behaviour, scrub interaction,
  overflow-menu contract, safe-area geometry, testing, and the publishing
  checklist for a future package.
- [Mobile app](./mobile.md) — the Expo Router app (`apps/mobile`): Better Auth
  Expo integration, capability-driven tabs, offline scanners, and participant
  screens, with the per-story status registry.
- [Mobile builds and release](./mobile-release.md) — index into three
  focused runbooks: [local dev/builds](./mobile-dev-setup.md) (EAS profiles,
  prebuild, local/cloud compilation), [credentials](./mobile-credentials.md)
  (signing, push, Wallet certs), and
  [store release](./mobile-store-release.md) (artwork, privacy declarations,
  submission, release checklist).
- [UI testing](./ui-testing.md) — the shared browser/native selector contract,
  Playwright browser projects, fast React Native screen tests, optional
  Detox simulator/device runs, and the screenshot-on-UI-PRs rule.

Deployment:

- [Environment variables per service](./env-vars.md) — for each container in
  an isolated deploy (`deploy/services/*`), exactly which env vars it needs and
  whether they're read at container start or baked in at build time.
- [Big-event readiness](./big-event-readiness.md) — the concrete pre-event
  checklist for ~600 concurrent users: what to set (`DB_POOL_MAX`, memory
  limits, replica counts), the Postgres connection budget arithmetic, load
  testing the hot paths, and the monitoring queries to watch during the event.

Historical (not required reading — see [`audits/README.md`](./audits/README.md)):

- [Access-control audit and consolidation plan](./audits/access-control-audit-plan.md)
- [Web UX simplification audit and task plan](./audits/ux-audit-tasks.md)
- [Application form builder UX audit](./audits/ux-audit-application-builder.md)
- [Applications & identity: implementation notes](./audits/implementation-notes.md)

See also the root [`README.md`](../README.md) for local dev setup, the API's
own `/documentation` (Swagger UI, generated from route schemas — not a file in
this folder), [`apps/web/README.md`](../apps/web/README.md) for web frontend
conventions and the component library, and
[`deploy/README.md`](../deploy/README.md) for the full deployment story
(networking, secrets, Dokploy modes).
