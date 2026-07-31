# hackOS — architecture docs

Living documentation for how the current code implements the product. The
normative functional source of truth remains `plan/historias-hackos.md`
(stories H1–H55) and `plan/07-datos-relevantes-ers.md` (hard invariants);
this folder explains *how* the code implements the relevant slices. If a doc
here disagrees with `plan/`, the plan wins and the doc (or the code) is the bug.

Reading order for a new agent/contributor: [`AGENTS.md`](../AGENTS.md)
(entry point, prescribed reads) → `CLAUDE.md` (conventions every change must
follow) → root [`README.md`](../README.md) (setup) → the **one-paragraph
orientation** below → whichever module doc matches your task.

## Index

Architecture & modules:

- [Architecture & infrastructure](./architecture.md) — the system view: the six
  services and their stacks, the two-network security boundary, state ownership
  (Postgres truth vs. ephemeral Valkey), realtime SSE fan-out, the one-image
  model, scalability (more workers, the Postgres ceiling, multi-instance
  tenancy), the reasoning behind the big decisions, and the small-vs-real
  deployment profiles. Start here for the whole-system picture;
  `deploy/README.md` is the operational runbook.
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
  how the Wallet pass renders from it (field visibility, captions, back fields),
  plus the session-less scoped-token path from the acceptance email.
- [TV screens](./tv-screens.md) — what the venue's screens show and why: the
  override / timetable / default precedence, the combined live screen and its
  payload, slot rotation, venue Wi-Fi, and how each mode adapts to any screen
  size or aspect ratio.
- [Access-control audit and consolidation plan](./access-control-audit-plan.md)
  — implementation status and the Orca-orchestration brief for mandatory route
  policies, contextual authorization, immediate capability revocation,
  permission-group safety and templates, SSE isolation, the task DAG, and the
  release gate.
- [Generated API route-policy ledger](./access-control-route-ledger.md) — the
  complete sorted runtime declaration inventory and public/token allowlist
  snapshot; regenerate it with `pnpm --filter @hackos/api route-policy:audit`.

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
- [UI testing](./ui-testing.md) — the shared browser/native selector contract,
  Playwright browser projects, fast React Native screen tests, and optional
  Detox simulator/device runs.

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
