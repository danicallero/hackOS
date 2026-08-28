# Challenges & Devpost Projects — architecture

Covers the `challenges` and `projects` modules and the Devpost intake pipeline
(H16, H17, H44, H45, H46 plus the `PROJECTS_READ` views the queue workstream
consumes). Functional source of truth is `plan/historias-hackos.md`; where this
document and the stories disagree, the stories win.

> **Scope note.** As of this writing both modules are **fully implemented and
> covered by the integration suite** (`apps/api/test/challenges`,
> `apps/api/test/projects`). This document describes the system as built. It
> also records, at the end, three places where a naive "generic CRUD +
> background-worker import" reading diverges from the stories and was therefore
> *not* built.

---

## 1. Module overview

### 1.1 Domain model (pre-existing tables — no new migrations)

The relationships already exist in `0001_initial.sql` and `0300_projects_devpost.sql`.
This code adapts to them; it does not reshape them.

```
users ──< submissions >── repos ──< repo_devpost_prizes >── devpost_prizes
  │            (team)      (project)         │ (prize name, text)
  │                                          │
  │                                          └───── challenges.devpost_tags (jsonb[])
  │                                                        ▲  reconciliation key
devpost_participants ── user_id ─┘                         │
  (staging: one row per person per repo, merge_status)     │
                                                            │
enterprises ──< sponsors >── challenges ──< challenge_versions
                (author)      (reto)         (immutable snapshots, H44)
```

Key facts that drive every design decision below:

- **A "project" is a `repos` row.** "Team" is not a table — team membership is
  the set of `submissions (repo_id, user_id)` rows for a repo. There is no
  `teams` table and no `project_challenges` join table.
- **Challenge ↔ project is *indirect*, through the prize name.** hackOS mirrors
  Devpost's model: a project opts into *prizes* (`repo_devpost_prizes.prize`,
  free text straight from the CSV), and an operator maps a prize name onto a
  challenge by appending it to `challenges.devpost_tags` (a jsonb array). The
  join "which challenges is repo R in?" is computed at read time:
  `repo_devpost_prizes.prize` ∈ `challenges.devpost_tags`. This is deliberate —
  it lets the import land before any prize→challenge mapping exists, and lets a
  single challenge absorb several Devpost prize spellings.
- **`challenges` has no `is_active` column.** Publication is governed by
  `status` (`draft` / `published`) and `visibility` (`hidden` / `visible`) plus
  `available_from` for the scheduled reveal (H45). Public reads filter on those
  three, never on a boolean "active" flag.
- **`devpost_participants` is a staging/reconciliation table**, distinct from the
  authoritative `submissions`. A participant is `unmatched`, `auto_matched`, or
  `manually_linked`; only matched participants get a `submissions` row.
- **Identity matching and roster correction are separate.** A primary-email
  match is automatic. A secondary-email match becomes automatic only after the
  address is verified, and replacing/removing that address revokes only links
  that depended on it. Operators do not mutate either identity when correcting
  a project: deleting an imported roster row removes that exact
  `devpost_participants` row (and its submission only when no other imported
  identity still represents the account); manually-added roster entries use the
  separate `submissions` member route.
- **Queue availability uses the full roster relation (H30).** The busy-member
  guard and its operator-facing skip projection consider `submissions`, linked
  `devpost_participants`, and primary/verified-secondary email matches. This
  keeps judging safe while legacy imports are being reconciled and matches the
  membership relation used by queue roster and notification reads.

### 1.2 Challenges module (`apps/api/src/modules/challenges/`)

Challenges are owned through the sponsor lifecycle: an admin creates a challenge
template bound to an enterprise, and sponsor rows on that enterprise grant the
representatives access to their own challenge and enterprise even if they hold no
explicit portal capability. Admins control publication/reveal; sponsors edit the
challenge content and judging panel under the H44/H45 rules below.

| Method & path | Capability | Story | Behaviour |
|---|---|---|---|
| `GET /api/challenges` | `sponsors:manage` OR `queue:admin` | H44/H46 | admin-wide list |
| `POST /api/challenges` | `sponsors:manage` OR `queue:admin` | H43/H44 | create hidden draft template bound to an enterprise |
| `GET /api/challenges/mine` | authenticated + sponsor row | H44/H46 | challenges owned by the caller's enterprise |
| `GET /api/challenges/:id` | ownership check | H44 | single challenge |
| `PATCH /api/challenges/:id` | ownership check | H44 | partial edit + version snapshot + audit |
| `POST /api/challenges/:id/publish` | `sponsors:manage` OR `queue:admin` | H45 | publish immediately or schedule reveal |
| `POST /api/challenges/:id/unpublish` | `sponsors:manage` OR `queue:admin` | H45 | hide a mistakenly published challenge |
| `GET /api/challenges/:id/panel/preview` | ownership check | H44 | typed judging panel + lock state |
| `GET /api/challenges/:id/versions` | ownership check | H44 | immutable edit history |

`POST /api/challenges` resolves the supplied `enterpriseId` to the existing
`sponsors` ownership model. If the enterprise has no sponsor row yet, the service
creates a nullable-user sponsor anchor (`sponsors.user_id IS NULL`) so
`challenges.author` can still point at that enterprise without inventing a new
table or migration. Later reps gain access through their own sponsor rows on the
same enterprise.

**Edit safety (H44).** `updateChallenge` runs `SELECT … FOR UPDATE`, writes one
immutable `challenge_versions` snapshot and one `audit` row inside the same
transaction as the `UPDATE` (per CLAUDE.md invariants 3, 6). The **judging panel
is frozen once judging starts**: `panelIsLocked()` compares now against
`queue_settings.schedule_start_at`, and any patch touching
`judging_panel_criteria` after that instant is rejected with a `ConflictError`
(`code: panel_locked`). This is the "restrict editing critical evaluation
criteria once paired with judging" rule from the brief — realised through the
judging clock, which is the deadline the stories actually name, not through a
"has submissions" heuristic. Once a challenge is published or archived, sponsor
owners can still update the judging panel and presentation duration until that
judging deadline, but the public/general fields (`title`, `description`,
`criteria`, `prizes`) are admin-only.

**Winner eligibility is queue-group scoped (H46).** `winners.ts` records each
win against the exact `challenge_id` the sponsor is picking for —
`challenge_winners` keeps its `UNIQUE(challenge_id, rank)` and
`UNIQUE(challenge_id, repo_id)` unchanged. What widened is the *entrant* check:
a repo qualifies if it has a `queue_entries` row (or a `repo_devpost_prizes` ↔
`challenges.devpost_tags` match, for enterprises that opted out of the queue)
against **any challenge in the target challenge's `queue_group`**, not only the
target challenge itself. A newly created challenge starts in a 1:1 group, so
the set is initially exactly `{challengeId}` and the rule is indistinguishable
from the pre-group behaviour. It widens only after an enterprise explicitly
merges several challenges into one shared judging queue, at which point a repo
judged once through that queue is a legitimate candidate for every prize the
queue feeds. When a repo qualifies through more than one challenge in a group,
the selected prize still records the exact `challenge_id` chosen by the
sponsor; no implicit cross-challenge win is created.

### 1.3 Projects module (`apps/api/src/modules/projects/`)

| Method & path | Capability | Story | Behaviour |
|---|---|---|---|
| `GET /api/public/challenges` | public | H49 | published + visible + revealed challenges w/ prizes |
| `POST /api/devpost/imports/preview` | `projects:import` | H16 | pure read-only import plan |
| `POST /api/devpost/imports/confirm` | `projects:import` + idempotency | H16 | transactional upsert |
| `GET /api/devpost/imports/unmatched` | `projects:import` | H17 | participants no email matched |
| `POST /api/devpost/imports/link` | `projects:import` | H17 | manually link participant → account |
| `POST /api/devpost/imports/link-secondary` | `projects:import` | H6/H17 | request secondary verification; link activates only after verification |
| `POST /api/devpost/imports/claim-email` | `projects:import` + idempotency | H17 | fire account-claim invite |
| `POST /api/devpost/prizes/:prizeName/map` | `projects:import` | H16 | append prize to a challenge's `devpost_tags` |
| `GET /api/repos` | `projects:read` | H20/queue | repos + members + prizes + mapped challenges |
| `GET /api/repos/:id` | `projects:read` | H20/queue | one repo, same shape |
| `GET /api/projects/member-candidates` | `projects:edit` | H21 | minimal account search for team editors |
| `POST /api/repos` | `projects:edit` + idempotency | H18 | native creation: metadata + members + challenge lineup in one transaction |
| `PATCH /api/repos/:id` | `projects:edit` | H18 | metadata edit (name, description, links), audited before/after |
| `POST /api/repos/:id/members` / `DELETE …/members/:userId` | `projects:edit` | H21 | hot-edit manually-added membership |
| `DELETE /api/repos/:id/devpost-participants/:email` | `projects:edit` | H21 | remove one exact imported roster row |
| `POST /api/repos/:id/challenges` / `DELETE …/challenges/:challengeId` | `projects:edit` | H21 | enqueue at queue bottom / remove + compact positions |
| `GET /api/me/projects` | authenticated | H20 | participant self-view: team roster (teammate emails redacted to `null`), challenges, live queue status, plus `canCreate` (H19 policy ∧ admitted participant ∧ hacking window open) |
| `POST /api/me/projects` | authenticated + idempotency | H19 | participant self-creation, gated by the event policy, admitted-participant eligibility, and the hacking window; a participant may now hold more than one project |
| `PATCH /api/me/projects/:id` | authenticated | H19/H20 | participant self-edit of their own project's metadata — active members only |
| `POST /api/me/projects/:id/invites` | authenticated + idempotency | H19/H20 | active member invites a teammate by email; pending until accepted |
| `GET /api/me/projects/invites` | authenticated | H19/H20 | pending invites addressed to the caller |
| `POST /api/me/projects/invites/:id/accept` \| `.../decline` | authenticated + idempotency | H19/H20 | invitee accepts (becomes an active member) or declines (row deleted) their own invite |
| `DELETE /api/me/projects/:id/leave` | authenticated + idempotency | H19/H20 | active member leaves; 409 if they're the last member |
| `DELETE /api/me/projects/:id` | authenticated + idempotency | H19/H20 | the project's sole remaining member deletes it outright, cascading queue/judging rows |

**Native lifecycle (H18-H19).** `repos.source` distinguishes `'devpost'` from
`'native'` rows (migration `0301`), and the import's name-dedupe skips native
repos so a re-import can never clobber a hand-made project. Challenge lineups
chosen at creation reuse the same enqueue core as the H21 hot edit
(`enqueueRepoOnChallenge`): append at the bottom of the challenge's queue, one
`queue_history` row + one audit row + one `QUEUE_ENTRY_CHANGED` broadcast per
mutation. Participant self-creation is gated by
`event_config.participants_can_create_projects` (H19, exposed on
`GET /api/public/event` and toggled from the event settings page), limited to
one project per participant (advisory-locked, exactly one winner under
concurrency), and only accepts publicly visible challenges.

**H19/H20 self-service (supersedes H20's "read-only" text — product decision,
not a `plan/` edit).** `plan/historias-hackos.md` still literally says a
participant "no puedo modificar nada de esto yo mismo" for H20. That framing
predates H19's policy-gated self-creation; once an event turns the H19 policy
on, participants get full self-service on their **own** project — edit
metadata, invite/accept/decline teammates, leave, and (as the sole remaining
member) delete it — not just view it. `plan/` is read-only and stays exactly
as written; this doc records the deliberate supersession instead. Two gates
apply to every self-service mutation, on top of `participants_can_create_projects`:

- **Admitted-participant eligibility** (`isAdmittedParticipant` in
  `service.ts`) — a thin wrapper around `computeDerivedRole` +
  `hasMobileAccess` (identity module), reused verbatim rather than
  reimplemented. An account that isn't an accepted/confirmed applicant (or an
  operational role) can't create, be invited into, or otherwise touch a
  project this way.
- **Hacking window** (`assertWithinHackingWindow` /
  `isWithinHackingWindow`, `src/lib/hacking-window.ts`) — both
  `event_config.hacking_starts_at` and `hacking_ends_at` must be set and
  `now()` must fall between them; an unset window reads as closed, not
  unrestricted. Staff (`PROJECTS_EDIT`) routes are NOT subject to this gate —
  operators can still correct teams/challenges any time (H21).

**Invites are opt-in, not instant adds.** `submissions` (migration `0303`,
`DELTA(H19,H20)`) gained `status` (`invited` | `active`, default `active` so
every pre-existing/H18/H21 row needs no backfill), `invited_by`, and
`responded_at`. `inviteProjectMember` inserts a `status='invited'` row and
notifies the invitee (`notify(... category: "project", template:
"project.invite" ...)`); the invitee must `accept` (flips to `active`,
stamps `responded_at`) or `decline` (deletes the row) themselves — nobody
else can act on their invite (wrong-user attempts read as 404, not 403, so a
participant can't probe whether an invite exists for someone else).
`isActiveProjectMember`/`activeProjectMemberCount` and every other roster
read (`attachMembersAndPrizes`, `myProjects`, the queue's
`REPO_MEMBER_RELATION_SQL`, `myQueueStatus`) all exclude `status='invited'`
rows — a pending invite is not yet a team member anywhere in the platform
(roster, queue notifications, "who may act on this queue entry").

**Delete only reaches a sole-member project.** `leaveMyProject` 409s if the
caller is the last active member (delete instead); `deleteMyProject` re-checks
membership and the sole-member count inside its own transaction, then cascades
every FK-referencing row (`queue_entries`, `queue_history`, `attempt_review`,
`attempt_review_versions`, `judging_session`, `submissions`,
`devpost_participants`, `repo_devpost_prizes`, `challenge_winners` — none of
those FKs cascade at the schema level) before deleting the repo itself. Queue
entry ids and fixture markers are captured before that delete; after commit,
each affected entry emits a marker-scoped queue invalidation and each affected
challenge queues a participant read-model refresh (H38/H41).

The self-view is still the only read that redacts the roster: `myProjects()`
nulls every member `email` except the caller's own, so teammates are listed by
name alone and a participant never learns another participant's address.
Staff reads (`GET /api/repos`, `GET /api/repos/:id`) keep the full roster —
they need it for linking and accreditation.

---

## 2. Devpost reconciliation — how prizes become challenges

The two Devpost exports live as reference fixtures at
`example-csvs/registrants.csv` (participants) and `example-csvs/projects.csv`
(projects). Column names drift between Devpost releases, so `csv.ts` matches
headers case/whitespace-insensitively against an alias table rather than by exact
name (e.g. `Opt-In Prizes` → `prizes`, `Team Member N Email` numbered columns →
member emails).

Planning (`plan.ts::buildImportPlan`) is **pure and read-only** so `preview` and
`confirm` share one code path and the preview is guaranteed to equal the write:

1. Parse both CSVs.
2. Join each participant row to its project by exact URL → normalized URL →
   normalized title (first hit wins).
3. Resolve every member email against `users` by **primary email OR verified
   secondary email** (H6). Unverified secondaries never match.
4. Compute the repo action (`create`/`update`) using the *same* key as the
   `repos_devpost_url_key` partial unique index, so planning and the
   `ON CONFLICT (devpost_url)` upsert always agree on the same row.
5. For each distinct prize name, look up challenges whose `devpost_tags`
   contains it (`devpost_tags ?| $1::text[]`) and attach the mapped challenge to
   the plan. **This is the reconciliation:** the importer never duplicates
   challenge data — it only records the prize string on the repo and resolves the
   challenge by tag membership at read time.

`mapPrizeToChallenge` is the operator action that closes the loop: it appends a
prize name to a challenge's `devpost_tags` (idempotently) and reports how many
already-imported repos now resolve to that challenge — **without** creating any
queue entries (enqueueing is the queue workstream's decision).

---

## 3. Consistency model — why the import is synchronous, not a worker job

The brief asks for a background worker + dead-letter queue for the bulk import.
**The import is deliberately synchronous and transactional instead**, and
`projects/index.ts` records this ("No workers needed"). The reasoning, grounded
in the stories and `plan/07-datos-relevantes-ers.md`:

- **H16 is an interactive operator flow:** upload → *see a preview of exactly
  what will be created* → confirm. A preview is only trustworthy if `confirm`
  does precisely what `preview` reported; the shared pure planner guarantees
  that. An async worker breaks the "preview equals result" contract because state
  can move between preview and execution.
- **Exactly-once, not eventually-consistent.** `confirmImport` runs the whole
  batch in one `withTransaction`. Every write is idempotent on a natural key, so
  re-uploading the same files updates rather than duplicates and a partial
  failure rolls the *entire* batch back — no half-imported state to reconcile,
  which is exactly what a DLQ would otherwise exist to clean up.

  | Entity | Idempotency key | On conflict |
  |---|---|---|
  | `repos` | `devpost_url` (partial unique) | update name/description/demo |
  | `devpost_participants` | `(repo_id, email)` | update, but **never clobber** a `manually_linked` row |
  | `repo_devpost_prizes` | `(repo_id, prize)` | do nothing |
  | `devpost_prizes` | `name` | bump `last_batch` |
  | `submissions` | `(repo_id, user_id)` | do nothing |

- **"Unrecognized people" is not a failure to retry — it's a first-class
  outcome.** Devpost emails that match no account are stored with
  `merge_status = 'unmatched'` and surfaced through `GET …/unmatched` (H17), then
  resolved by a human via `link` or `claim-email`. That human-in-the-loop queue
  *is* the "dead-letter" mechanism the stories call for; a machine DLQ would be
  the wrong tool because these need an operator decision, not an automatic retry.

### 3.1 Where real background work does happen

The system does use BullMQ workers (`registerWorker` from `src/lib/queues.ts`),
just not for the import transaction itself. The one asynchronous hop in this
pipeline is **notification delivery**: `sendClaimEmail` (H17) writes a
`notification_outbox` row *inside the same transaction* as the token and the
`claim_email_sent_at` stamp; the notifications worker picks that row up and sends
the email out of band. So the boundary is:

| Handled synchronously (API controller, in-transaction) | Handled asynchronously (worker) |
|---|---|
| CSV parse, join, account matching (`preview`) | claim-email delivery via `notification_outbox` |
| repo/participant/prize/submission upsert (`confirm`) | — |
| manual link, prize→challenge mapping | — |
| audit + version snapshots | — |

Event/SSE broadcasts (`broadcast(topic, EVENT, …)`) belong to the queue
workstream when repos are enqueued for judging; the intake pipeline itself emits
no realtime events — it produces the data the queue module later acts on.

---

## 4. Permissions & audit (guardrails)

### 4.1 Contextual authorization (H16-H21, H43-H46)

Every projects, challenges, and sponsors route declares an explicit
`RouteAccessPolicy` in the API route ledger. Named enterprise, challenge, and
repository pre-handlers resolve the actual database resource before a handler
runs: anonymous private calls receive `401`; authenticated callers without a
global capability or the exact relationship receive `403`.

- `projects:read` (and the administrator wildcard) is global. Sponsor
  representatives otherwise see only repositories attached to challenges of
  their own enterprise, and roster judges see only repositories attached to
  the challenges of an enterprise they judge for. A repository identifier is
  checked against that derived scope, so a foreign repository probe fails closed.
- `sponsors:manage` and `queue:admin` remain global for their challenge
  operations. A sponsor row grants access only to its enterprise's challenges;
  an `enterprise_judges(enterprise_id, user_id)` row grants read/panel access
  to that enterprise's challenges only, never edit access.
- Enterprise profile routes resolve `:id` before authorizing. A representative
  can edit only their linked enterprise and its owner-editable fields; an
  unrelated enterprise id is forbidden. Nested project/challenge operations
  continue to validate the supplied parent and child pair in the same domain
  transaction (for example, a winner repo must be entered in that challenge, or
  in one sharing its queue group — see §1.2).

- Every mutating route is guarded by `requireCapability`/`requireAnyCapability`
  by capability, never by role (H8): `projects:import` for all Devpost intake,
  `projects:read` for the repo views, `sponsors:manage` /
  `queue:admin` for challenges. Ownership-sensitive challenge routes additionally
  check the challenge author's enterprise against the caller inside the handler.
- Critical mutations carry `idempotencyGuard` (import confirm, claim-email).
- Every sensitive mutation writes an `audit(...)` row in the same transaction as
  the domain write (H53): import confirm, manual link, claim-email, prize
  mapping, and every challenge edit.

---

## 5. Deviations from the brief (recorded, not silently dropped)

Three items in the originating brief conflict with `plan/historias-hackos.md`,
which per `CLAUDE.md` overrides any conflicting instruction. They were **not**
implemented:

1. **Participant "max challenges per project" + "freeze participant edits at a
   deadline."** H20's literal text says participants cannot modify their
   project, team, or challenges ("*No puedo modificar nada de esto yo
   mismo*"). A later product decision (§1.3, "H19/H20 self-service") supersedes
   that for *existing* projects once the H19 policy is on: participants can
   edit, invite/accept/decline teammates, leave, and delete their own project,
   gated by admitted-participant eligibility and the hacking window. There is
   still no "max challenges per project" or numeric edit-freeze-at-a-deadline
   flow — the hacking-window gate is the deadline mechanism the stories and
   this decision actually call for, not an extra lock/limit the brief invented.
2. **Generic challenge Delete CRUD.** Challenges are created and owned through
   the sponsor lifecycle (H43/H44), and publication is an admin-controlled
   status/visibility transition. There is still no delete endpoint; the "prevent
   delete when linked" rule is moot because deletion isn't a story.
3. **`is_active` filter.** No such column exists. Activation is `status` +
   `visibility` + `available_from` (H45). Public/list reads filter on those.
