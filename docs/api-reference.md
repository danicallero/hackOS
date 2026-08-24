# API reference — module and convention overview

The hand-written tour of `apps/api`: what each module owns, and the
conventions that hold across all of them. It exists because `plan/`,
`architecture.md`, `background-workers.md` and the per-module docs each tell
one slice of the story well — this page is the map between them, plus the
things (capability list, error shape, route-policy kinds) that don't have a
doc of their own.

**This is not a route-by-route spec.** Every route's request/response shape
is generated straight from its Zod schema and served live at `/documentation`
(Swagger UI) — that *is* the API doc; nothing here duplicates it. What follows
is the layer above individual routes: which module owns what, and the rules
every module follows so a change in one reads predictably next to the others.

Functional source of truth: [`plan/historias-hackos.md`](../plan/historias-hackos.md)
(stories H1–H55). Hard invariants: [`plan/07-datos-relevantes-ers.md`](../plan/07-datos-relevantes-ers.md).
If this page disagrees with either, they win.

## Where to start

| Question | Read |
|---|---|
| "What does hackOS do, how do I run it locally?" | root [`README.md`](../README.md) |
| "How is the system deployed — services, networks, scaling?" | [`architecture.md`](./architecture.md) |
| "What's this route's exact request/response shape?" | `/documentation` (generated, not a file) |
| "What does module X own, module by module?" | this page, § Modules |
| "Which capability guards which route?" | [`access-control-route-ledger.md`](./access-control-route-ledger.md) (generated) |
| "How does background work / retries / the outbox work?" | [`background-workers.md`](./background-workers.md) |
| "What changed recently, story by story?" | [`modules-1-5.md`](./modules-1-5.md), [`challenges-devpost.md`](./challenges-devpost.md) |

## Shape of the system

Fastify 5 + `fastify-type-provider-zod`, raw parameterized SQL via `pg` (no
ORM — see `architecture.md` §8 for why), Better Auth for sessions, BullMQ +
Valkey for background ticks and realtime fan-out, MinIO (S3-compatible) for
files. Postgres is the only durable source of truth; Valkey and in-memory SSE
subscriber lists are fully disposable (`architecture.md` §4). The API and the
background worker ship as the same image (`apps/api/Dockerfile`) and share
every domain module — the worker just runs `dist/worker.js` instead of
`dist/server.js` and never opens an HTTP listener.

Each domain is a directory under `apps/api/src/modules/<domain>/` exporting
`register<Domain>Module(app)`, wired up in one alphabetical line each from
`src/modules/index.ts`:

```
registerModules(app)
├─ applications   (WS-A2 · H11-H15, H27)
├─ challenges     (WS-G  · H44)
├─ event          (WS-G  · H45, H47)
├─ exports        (WS-F  · H54)
├─ identity       (WS-A1 · H1-H10)
├─ logistics      (WS-C  · H22-H27)
├─ notifications  (WS-F  · H50-H53)
├─ projects       (WS-B1 · H16-H17)
├─ queue          (WS-B2 · H29-H42)
└─ sponsors       (WS-G  · H43-H45, H58)
```

A module owns routes, its own DB access (no cross-module raw SQL — call the
other module's exported function instead), and, if it does background work, a
`registerWorker(name, processor)` call at import time (`lib/queues.ts`).

## Modules

### identity (H1–H10)
Better Auth session lifecycle (`/api/auth/*`, pass-through, exempt from the
route-policy ledger by design), the caller's own profile (`GET/PATCH
/api/me`), staff user management, secondary-email verification (H6),
invitations including reusable enterprise links (H9/H10/H43), and the
permission-group graph: capability groups, groups-of-groups with cycle
rejection, and the `ADMIN_ALL` wildcard's "at least one active holder"
invariant (`permission-graph.ts`). Account removal (H54) branches to hard
delete or field-level anonymization depending on whether the account has any
retained activity. A generic per-account UI-preference store (`GET/PATCH
/api/me/ui-prefs`, H59) namespaces one jsonb column by view (e.g.
`scheduleTable` holds the Manage Schedule table's column visibility/order) —
a thin merge-patch, not a table per view; the browser also keeps a
localStorage copy for an instant read, and this is what makes the preference
follow the account across devices. `docs/modules-1-5.md` M1 tracks recent
story-level changes here.

### applications (H11–H15, H27)
Configurable application forms (`applications` table), an applicant's
draft/submit flow with a verified-email gate, staff review + scoring, batch
and per-response accept/reject decisions, the three confirm/decline paths
(email link, authenticated web, admin override — H15), file uploads for
template `file` fields proxied through an owner-or-staff check (never a
presigned URL), and the pre-event stats panel (H27). The confirmation-window
expirer (`applications/expirer.ts`) is a background tick, not a request path.

### projects (H16–H17, H21)
A "project" is a `repos` row; "team" is the set of `submissions (repo_id,
user_id)` rows — there is no `teams` table. The Devpost CSV import pipeline
stages rows in `devpost_participants` (`unmatched` / `auto_matched` /
`manually_linked`) and reconciles them against primary/verified-secondary
emails without ever silently merging identities. Challenge↔project linkage is
indirect, through `repo_devpost_prizes.prize` matching a challenge's
`devpost_tags`. Full detail: [`challenges-devpost.md`](./challenges-devpost.md).

### challenges (H44)
Sponsor-owned challenge templates bound to an enterprise: draft/published
status, hidden/visible visibility, a scheduled `available_from` reveal,
immutable version snapshots on edit, and winners. Admins control publication;
sponsor reps (via a `sponsors` row on their enterprise, not necessarily an
explicit capability) edit their own challenge's content and judging panel.

### queue (H29–H42)
The judging queue state machine — `waiting → called → in_room → presenting →
completed/disqualified`, one queue entry per repo per challenge, hard
guarantee that a team is never called into two rooms while a member is
occupied elsewhere. Rooms, the auto-call pump tick, judge evaluation (1:1
with a queue entry), and the data behind the venue TV screens (mode
precedence: operator override → scheduled `tv_slots` → default rooms) all
live here. Every queue action writes exactly one history row and emits
exactly one broadcast (`plan/07` invariant 5).

Judges are **enterprise-scoped**, not room-scoped: `enterprise_judges`
(`enterprise_id`, `user_id`) is the roster, and a judge on it reaches every
challenge that enterprise authored and every room currently serving one of
those challenges. Contextual queue guards resolve the chain
`room → room_queue_groups → queue_groups.enterprise_id →
enterprise_judges` rather than looking a judge up per room. The roster itself
is managed on the enterprise (`/api/enterprises/:id/judges`, sponsors module);
the queue module has no room-scoped judge routes.

### logistics (H22–H27, H59)
Accreditation (badge issuance, rotation, revocation), presence (door in/out
with certainty-window derivation and conflict detection), meal/activity
scanning, the pre-event schedule, cross-station people search, and Apple/Google
Wallet pass issuance + the Apple PassKit web-service protocol. Scanner
mutation routes carry `idempotencyGuard` so an offline device's queued retries
never double-apply.

Schedule items (H48) carry an optional `audiences` set
(`sponsor`/`participant`/`mentor`). Staff always sees every item
unconditionally and is never a stored audience value; an empty `audiences`
array means "staff-only" — and a staff-only item has no meaningful
`visibility` at all, since `visibility`/`publishAt` only describe *when a
tagged audience* gets to see an item. `createScheduleItem`/`updateScheduleItem`
silently force `visibility` back to `hidden` and `publishAt` to `null` the
moment an item ends up with no audience (not a validation error — removing
the last audience tag is a normal edit); the bulk `POST /api/schedule/visibility`
(`shown`) and `POST /api/schedule/publish-at` (non-null) routes silently skip
any staff-only item in their batch rather than fail it. A DB constraint,
`schedule_visibility_requires_audience` (0720), backstops this at the data
layer: `array_length(audiences,1) > 0 OR (visibility = 'hidden' AND publish_at
IS NULL)`. There is no separate `public` audience — the anonymous web/TV feed
is served exactly the `participant` slice. Items also carry an optional
staff-only `notes`
free-text field (the run-of-show's "observations" column), an optional
`contactNote`, and responsible-person assignment via `schedule_owners`
(`GET/POST /api/schedule/:id/owners`, `DELETE /api/schedule/:id/owners/:ownerId`,
`SCHEDULE_MANAGE`-gated, modeled on the `sponsors` enterprise-member join
table). Each owner row is either a real hackOS account (`userId`) or a
free-text name with no login (`freeTextName`) — exactly one of the two, per
`schedule_owners_exactly_one_identity`; the delete route keys off the owner
row's own `id`, not `userId`, since a free-text row has none. Picking a
responsible person searches `GET /api/schedule/owner-candidates`
— `SCHEDULE_MANAGE`-gated like the write itself, deliberately not the broader
`USERS_READ` (mirrors `projects`' `listProjectMemberCandidates`). A scannable
item must include `participant` in its `audiences`; the API rejects
`requiresScan: true` otherwise (H59 — a staff/sponsor/mentor-only item has no
business being scanner-registrable). `POST /api/schedule/publish-at` sets a
shared scheduled-reveal time for several items at once (`SCHEDULE_MANAGE`,
one audit entry + one broadcast for the whole batch), alongside the existing
single-item `publishAt` field and the bulk `POST /api/schedule/visibility`.
`GET /api/public/activities` is audience-aware and anonymous-callable
(treated as `participant`). An authenticated caller holding any capability
("staff") bypasses both the audience filter *and* the visibility/publishAt
one — every item regardless of state, including drafts and items still
scheduled to reveal, each with its owners, contactNote, notes, and its own
`visibility` (staff-only field, lets a client tell a draft apart from a live
item) — previewing a draft on the run-of-show doesn't require publishing it
first. The `SCHEDULE_MANAGE`-gated `GET /api/schedule` is the same full
listing plus bulk-management concerns and is what the web "Manage Schedule"
table uses. A linked sponsor rep instead only sees *live* items explicitly
tagged `sponsor`, with owners/contactNote but never the (staff-internal)
notes/visibility. One feed, not three parallel endpoints.

### notifications (H50–H53)
The in-app inbox, scheduled announcements (with translations and a
publication window), per-user notification preferences, multi-channel
delivery (email, push, Discord, in-app) driven entirely by the durable
`notification_outbox` table, and the read-only audit-trail query surface
(H53). See [`background-workers.md`](./background-workers.md) for the
dispatcher's retry/backoff and dead-letter model — there is no BullMQ-native
retry queue here on purpose.

### sponsors (H43–H45, H58)
Enterprises, sponsor (rep) membership on an enterprise, and the
enterprise-invite-link flow that lets an org self-serve rep accounts without
staff creating each one by hand. Also owns the sponsor-only FAQ singleton
(`GET/PUT /api/sponsor-faq`, H58) — an ordered `items` array, each item either
a Q&A pair (`kind: 'qa'`) or a free-form text block (`kind: 'text'`), trilingual,
saved wholesale (same "admin-edited jsonb array" shape as
`challenges.prizes`/`judging_panel_criteria`). Readable by any linked sponsor
rep or a `sponsors:manage` admin, writable only by the latter; access is a
"sponsor-portal-access" contextual policy (any row in `sponsors`, deliberately
narrower than `challenges`' judge-inclusive `challenge-directory` policy).

Also owns the **judge roster** (`/api/enterprises/:id/judges`,
`/api/enterprises/:id/judge-candidates`): an enterprise's `enterprise_judges`
rows, managed by a `queue:admin`/`sponsors:manage` administrator or the
enterprise's own representatives (the `enterprise-judge-manage` contextual
policy) and never by the roster judges themselves. The candidate pool is
deliberately every account — enterprises may bring outside judges — and adding
one is silent: no invitation or consent step, the judge simply finds the
judging workspace on their next login. Roster membership is what grants
judging access to the enterprise's challenges and rooms (see `queue` above);
it does **not** grant sponsor-portal/FAQ access.

### event (H45, H47)
The `event_config` singleton: event identity/tagline, the public countdown
windows (doors-open vs. hacking window vs. the read-only judging window
mirrored from `queue_settings`), venue name/GPS, Wi-Fi credentials
(staff-only — never on the public feed), and the Apple/Google Wallet pass's
configurable back-field list and per-field visibility. See
[`event-config-wallet.md`](./event-config-wallet.md).

### exports (H54)
Two distinct things share this module: operational CSV exports (attendance,
meals, applications, staff scan stats) gated by `exports:run`, and the GDPR-
style data-subject request workflow (export or deletion, the latter also
requiring `ADMIN_ALL`) with a background worker that builds the bundle and a
proxied, owner-or-staff download route.

## Cross-cutting conventions

These apply uniformly across every module above; a route or PR that doesn't
follow one of them is the exception to flag, not the norm.

### Capability-based authorization (H8)
Every capability is one string in [`packages/shared/src/capabilities.ts`](../packages/shared/src/capabilities.ts)
(`<domain>:<action>`, e.g. `queue:operate`, `applications:decide`); `*`
(`ADMIN_ALL`) is the wildcard that passes every check. Routes never check a
role — they guard with `requireCapability(CAPABILITIES.X)` /
`requireAnyCapability(...)` from `lib/capabilities.ts`. A "role" (participant,
judge, sponsor, staff…) is always *derived* from capabilities and
relationships for display purposes only; it is never the permission source
(`plan/07` invariant 13). This is also why the mobile app's tabs and the web
app's workspaces can change for a user the instant their capabilities change,
with no reinstall or redeploy (H55).

### Route access policy
Every application route declares a machine-readable `RouteAccessPolicy` in
its `config` (`lib/route-policy.ts`), built with the shared
`routeAccessConfig`/`routeAccessOption` helpers so every module wires it up
the same way:

| Kind | Meaning |
|---|---|
| `public` | Anonymous, tagged with an `AnonymousAccessCategory` (health / public-content / public-announcement / public-tv / public-invalidation) for the audit script to bucket by risk. |
| `token` | A single-purpose token proves the caller, not a session (invite accept, spot confirmation, scoped wallet access, Apple PassKit). |
| `authenticated` | Any signed-in user; the handler scopes further by `req.userId`. |
| `capability` | `capability` / `allOf` / `anyOf` against the catalogue above — exactly one of the three. |
| `contextual` | A named resolver loads and cross-checks the actual target resource (never trusts a parent id supplied by the caller) before deciding access — used for anything scoped to "my own X" or "X I have a relationship to" (e.g. a sponsor's own enterprise, an upload's owner). |

`registerRoutePolicyInfrastructure` validates every declared policy at route
registration and can enforce that *every* application route has one; the full
current inventory is generated by `pnpm --filter @hackos/api route-policy:audit`
into [`access-control-route-ledger.md`](./access-control-route-ledger.md).

### Errors
Route handlers throw `AppError` subclasses from `lib/errors.ts` — never
return silent success or swallow a failure. The global error handler
(`app.ts`) maps them to one stable shape:

```json
{ "error": { "code": "conflict", "message": "...", "details": {} } }
```

| Class | Status | `code` |
|---|---|---|
| `BadRequestError` | 400 | `bad_request` |
| `UnauthorizedError` | 401 | `unauthorized` |
| `ForbiddenError` | 403 | `forbidden` |
| `NotFoundError` | 404 | `not_found` |
| `ConflictError` | 409 | `conflict` — capacity full, a double transition, a stale badge, an already-used token |
| `TooManyRequestsError` | 429 | `too_many_requests` — carries `retryAfterSeconds` |
| `ServiceUnavailableError` | 503 | `service_unavailable` — a dependent provider/credential isn't configured (e.g. unset Wallet signing keys) |

### Audit (H53)
Any sensitive mutation calls `audit(client, { actorId, entityType, entityId,
action, before?, after? })` from `lib/audit.ts` **inside the same transaction**
as the domain write it's recording — never as a fire-and-forget side effect
after commit, so the audit row and the mutation it describes can never
diverge. Read access to the resulting trail is itself capability-gated
(`audit:read`) via `GET /api/audit`. Each row is left-joined to `users` so the
response carries `actor_name`/`actor_surname`/`actor_email` alongside the raw
`actor_id` (null for system-originated rows); the query surface also accepts
an `actorQuery` filter that matches actor name/email instead of requiring the
numeric id.

### Concurrency & idempotency (`plan/07` §2)
State transitions (queue actions, confirmations, badge/ticket mutations,
permission-group edits) run inside `withTransaction` with `SELECT ... FOR
UPDATE` on the row(s) being transitioned, so exactly one concurrent request
wins and the others see the post-transition state, not a race. Critical
mutations additionally carry `preHandler: idempotencyGuard` (`lib/idempotency.ts`):
the same `Idempotency-Key` + same body replays the stored response instead of
re-executing; the same key with a *different* body is a 409; a concurrent
in-flight duplicate is a 409 with a retry hint. This is what lets a mobile
scanner replay its offline queue after reconnecting without double-scanning.

### Realtime (SSE)
`broadcast(topic, EVENT, data)` from `lib/sse.ts` publishes to
`sse:<topic>` in Valkey; every API instance relays to its own locally
connected clients, so TVs and operator panels stay live across a
horizontally-scaled API tier. Event names live in
[`packages/shared/src/events.ts`](../packages/shared/src/events.ts), never as
inline strings. CRUD mutations emit payload-free `domain.changed` signals on
their owning authenticated domain topic (`applications`, `projects`,
`identity`, `sponsors`, `logistics`, or `audit`); there is no global refresh
topic and the API deliberately has no cross-write read cache. Consumers refetch
Postgres-backed read models after their own topic fires. Public/TV/content
streams receive only a narrow, payload-free "something changed" mirror of the
relevant domain event and refetch their own sanitized projection — they never
see the operational payload. See `architecture.md` §5 for the fan-out diagram
and `background-workers.md`'s "Queue and public-screen streams" section for
exactly which stream sees what.

### Background work
Everything asynchronous is a **repeatable tick worker** draining a
Postgres-backed table (`notification_outbox`, due confirmations, scheduled
reveals, room queues) — not a per-job BullMQ queue with its own retry/DLQ.
Durability, retry/backoff (exponential, capped, dead-lettered into
`status='failed'` after `MAX_ATTEMPTS`) and the "exactly one winner" guarantee
all live in Postgres rows; BullMQ is just the clock. Full detail, including
which module events are synchronous-in-request vs. background, is in
[`background-workers.md`](./background-workers.md).

### Trilingual copy (i18n)
Anything a user reads — UI strings and outbound notification templates alike
— ships with `es`/`gl`/`en` at minimum; `pnpm check:copy` enforces that no
i18n entry is missing a language and that no story id or capability key
leaks into user-facing text.

## Exploring the live API

- `/documentation` — Swagger UI generated from every route's Zod schema; this
  is the authoritative request/response reference, always in sync with the
  code because there's nothing to hand-write or go stale.
- `pnpm --filter @hackos/api route-policy:audit` — regenerates
  [`access-control-route-ledger.md`](./access-control-route-ledger.md), the
  full sorted inventory of every route's access policy.
- `apps/api/test/helpers.ts` — `truncateAll()`, `createUser()`,
  `createUserWithCapabilities([...])`, `asUser(id)` for `app.inject()`; API
  tests are integration-first against real Postgres/Valkey, no mocks.

See root [`README.md`](../README.md) for the full local dev command
reference (`pnpm infra:up`, migrations, seeding, running the API/web/mobile
apps together).
