# hackOS — architecture docs

Living documentation for how the current code implements the product. The
normative functional source of truth remains `plan/historias-hackos.md`
(stories H1–H67) and `plan/07-datos-relevantes-ers.md` (hard invariants);
this folder explains *how* the code implements the relevant slices. If a doc
here disagrees with `plan/`, the plan wins and the doc (or the code) is the bug.

Reading order for a new agent/contributor: [`AGENTS.md`](../AGENTS.md)
(entry point, prescribed reads) → `CLAUDE.md` (conventions every change must
follow) → root [`README.md`](../README.md) (setup) → the **one-paragraph
orientation** below → whichever module doc matches your task.

**One-paragraph orientation.** hackOS is a Fastify API (`apps/api`, raw SQL,
no ORM) plus a Next.js web app and an Expo mobile app, all reading/writing the
same Postgres database and sharing capability names and realtime event names
from `packages/shared`. Every domain (identity, applications, projects, queue,
logistics, notifications, help desk and the rest registered in
`apps/api/src/modules/index.ts`) lives in its own `apps/api/src/modules/<domain>/` directory and follows the
same conventions: capability-based authorization (never role checks),
audited mutations in the same transaction as the write, `SELECT ... FOR
UPDATE` + idempotency keys on state transitions, and SSE realtime fan-out
through Valkey. [`api-reference.md`](./api-reference.md) is the map of what
each module owns and where those conventions live in code; the rest of this
folder goes deeper on one system, module, or client at a time.

## Index

One line per doc. Each topic has one home: link to it instead of restating it.

### Start here

| Doc | Read it for |
|---|---|
| [API reference](./api-reference.md) | What each `apps/api` module owns and the conventions shared by all of them |
| [Architecture & infrastructure](./architecture.md) | Services, network boundary, state ownership, scaling and the big decisions |
| [Database schema](./database-schema.md) | Generated ERD and the migration identity/checksum rules |
| [Design system, UI & UX](./DESIGN.md) | Tokens, containers, page hierarchy, accessibility and copy rules for every surface |
| [Navigation](./navigation.md) | Capability-to-workspace mapping on web and tabs on mobile |
| [Test coverage and execution](./testing.md) | Suite inventory, coverage map and runtime policy |
| [UI testing](./ui-testing.md) | Browser and native UI tests, selectors, and screenshots on UI PRs |

`/documentation` (Swagger UI) is the route-by-route reference, generated from
route schemas. Root [`README.md`](../README.md) covers local setup,
[`apps/web/README.md`](../apps/web/README.md) the web component library.

### Cross-cutting API systems

| Doc | Read it for |
|---|---|
| [Audit trail](./audit-trail.md) | What an audit entry stores, private-value minimization, autosave grouping (H53) |
| [Background workers](./background-workers.md) | BullMQ queues, retries, dead letters and the sync-vs-async map |
| [Idempotency matrix](./idempotency-matrix.md) | Retry classification of every state-changing route |
| [Rate limiting](./rate-limiting.md) | The Valkey-backed limiter, limits per endpoint class, fail-open behaviour |
| [Realtime transport](./realtime-transport.md) | The multiplexed stream, scopes, recovery and metrics |
| [Request admission](./request-admission.md) | P0–P3 priority lanes, reserved capacity and shedding |
| [Route-policy ledger](./access-control-route-ledger.md) | Generated list of every route and its access policy |

### Domains

| Doc | Read it for |
|---|---|
| [Account deletion](./account-deletion.md) | Data inventory, retention boundary and anonymization flows (H54) |
| [Attendance certificates](./certificates.md) | Policy, variants, PDF, verification code, override and revoke |
| [Catering and activity RSVPs](./catering-rsvp.md) | Per-activity answers, options, exclusions and headcounts |
| [Content reports](./content-reports.md) | Reports of projects and profiles, and the organiser inbox (H18) |
| [Event config & Wallet pass](./event-config-wallet.md) | The `event_config` singleton, pass rendering and the scoped-token page |
| [Event diary](./diary.md) | Saving people and sponsor stands by scan, privacy rules, stand tags (#935) |
| [GitHub activity](./github-activity.md) | Repo linking through the GitHub App, activity tracking, TV ranking |
| [Help desk](./help-desk.md) | Helper profiles, availability, routing, claims, coverage (H61–H67) |
| [Help desk client contract](./help-desk-contract.md) | Request/response contract the web and mobile clients rely on |
| [Judging timing](./project-lifecycle-audit.md) | Track targets, preparation allowances, timing rules (H30, H33–H37) |
| [Live Activities / Live Updates](./live-activities.md) | State builders, device registry, push worker, APNs/Android formats (#966) |
| [Multi-edition support](./multi-edition-plan.md) | Editions, roles per edition, `X-Edition`, read-only closed editions, closing effects (Spanish) |
| [Native projects](./projects.md) | Drafts, snapshots, phases, gallery, invitations, winners |
| [Notifications & announcements](./notifications.md) | Announcement model, targeting, and the outbox/dispatch pipeline (H50–H53) |
| [Onboarding](./onboarding.md) | Edition identity, resumable steps, RSVP answers, mentor publication |
| [Public profile](./directory.md) | The opt-in profile, who sees it, moderation (#934) |
| [Question-owned libraries](./form-libraries.md) | Library fields, participant proposals, curation |
| [Queue groups](./queue-groups.md) | Enterprise-scoped grouping of challenges into shared judging queues (H46) |
| [Queue operator console](./queue-operator.md) | Arrival board, team search, capability-gated actions |
| [Schedule categories](./schedule-categories.md) | The activity-kind registry and how to add or retire a kind |
| [Statistics dashboard](./statistics-dashboard.md) | Scopes, panel catalogue, aggregation, statistics ACLs |
| [Synthetic reviewer fixtures](./reviewer-fixtures.md) | Isolated reviewer accounts for store review |
| [TV screens](./tv-screens.md) | Modes, manual/default precedence, the combined live screen |

### Web

| Doc | Read it for |
|---|---|
| [Accessibility audit](./accessibility-audit.md) | The 2026-11-01 audit: fixed defects, per-route coverage, limits |
| [Help desk, web](./help-desk-web.md) | Web screens for helpers, requests, inbox and coverage |
| [Onboarding, web](./onboarding-web.md) | The `/onboarding` journey and organizer settings |
| [Onboarding social sharing](./onboarding-social-sharing.md) | The share step's card component |

### Mobile

| Doc | Read it for |
|---|---|
| [Mobile app](./mobile.md) | Auth, tabs, participant and operator screens, scanners, story status |
| [Mobile surface states](./mobile-surface-states.md) | Loading/empty/error/refresh matrix per route and sheet |
| [RouterTabs](./router-tabs.md) | The reusable tab shell: API, Liquid Glass, overflow, safe areas |
| [Builds and release](./mobile-release.md) | Index of the three runbooks below |
| [Local dev and builds](./mobile-dev-setup.md) | EAS profiles, prebuild, local and cloud compilation |
| [Credentials](./mobile-credentials.md) | Signing, push and Wallet certificates |
| [Store release](./mobile-store-release.md) | Artwork, privacy declarations, submission checklist |

### Deployment and operations

| Doc | Read it for |
|---|---|
| [Deployment runbook](../deploy/README.md) | Images, protected workflows, networking, secrets, rollout, rollback |
| [Environment variables](./env-vars.md) | Which variable reaches which Compose service |
| [Backups and restore](./backup-restore.md) | S3 backups, restore flow, the maintenance lock |
| [Email with Amazon SES](./email-ses.md) | Sender subdomains, DNS, SES setup |
| [Production capacity](./production-capacity.md) | The 500-connection model, RAM ceilings, Grafana signals |
| [Big-event readiness](./big-event-readiness.md) | Pre-event checklist for ~600 concurrent identities |

### Historical

Closed audits and task plans, not required reading: [`audits/README.md`](./audits/README.md).
