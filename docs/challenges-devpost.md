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

### 1.2 Challenges module (`apps/api/src/modules/challenges/`)

Challenges are authored by sponsors (H43 creates the enterprise + its challenge;
H44 edits it), so the module intentionally exposes **read + edit + history +
panel**, not generic create/delete. Deleting or hand-creating a challenge outside
the sponsor lifecycle is not a story and is not exposed.

| Method & path | Capability | Story | Behaviour |
|---|---|---|---|
| `GET /api/challenges` | `sponsors:manage` OR `queue:admin` | H44/H46 | admin-wide list |
| `GET /api/challenges/mine` | `sponsor:portal` | H44/H46 | challenges owned by the caller's enterprise |
| `GET /api/challenges/:id` | ownership check | H44 | single challenge |
| `PATCH /api/challenges/:id` | ownership check | H44 | partial edit + version snapshot + audit |
| `GET /api/challenges/:id/panel/preview` | ownership check | H44 | typed judging panel + lock state |
| `GET /api/challenges/:id/versions` | ownership check | H44 | immutable edit history |

**Edit safety (H44).** `updateChallenge` runs `SELECT … FOR UPDATE`, writes one
immutable `challenge_versions` snapshot and one `audit` row inside the same
transaction as the `UPDATE` (per CLAUDE.md invariants 3, 6). The **judging panel
is frozen once judging starts**: `panelIsLocked()` compares now against
`queue_settings.schedule_start_at`, and any patch touching
`judging_panel_criteria` after that instant is rejected with a `ConflictError`
(`code: panel_locked`). This is the "restrict editing critical evaluation
criteria once paired with judging" rule from the brief — realised through the
judging clock, which is the deadline the stories actually name, not through a
"has submissions" heuristic.

### 1.3 Projects module (`apps/api/src/modules/projects/`)

| Method & path | Capability | Story | Behaviour |
|---|---|---|---|
| `GET /api/public/challenges` | public | H49 | published + visible + revealed challenges w/ prizes |
| `POST /api/devpost/imports/preview` | `projects:import` | H16 | pure read-only import plan |
| `POST /api/devpost/imports/confirm` | `projects:import` + idempotency | H16 | transactional upsert |
| `GET /api/devpost/imports/unmatched` | `projects:import` | H17 | participants no email matched |
| `POST /api/devpost/imports/link` | `projects:import` | H17 | manually link participant → account |
| `POST /api/devpost/imports/claim-email` | `projects:import` + idempotency | H17 | fire account-claim invite |
| `POST /api/devpost/prizes/:prizeName/map` | `projects:import` | H16 | append prize to a challenge's `devpost_tags` |
| `GET /api/repos` | `projects:read` | H20/queue | repos + members + prizes + mapped challenges |
| `GET /api/repos/:id` | `projects:read` | H20/queue | one repo, same shape |
| `GET /api/me/projects` | authenticated | H20 | participant self-view (no member roster) |

**H20 is read-only for participants by design.** A participant can *see* their
project, team and challenges but cannot mutate any of it — corrections go through
queue-management/admin (H21). There is therefore **no participant
challenge-selection form and no "max challenges per project" API rule**; see §5.

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

- Every mutating route is guarded by `requireCapability`/`requireAnyCapability`
  by capability, never by role (H8): `projects:import` for all Devpost intake,
  `projects:read` for the repo views, `sponsor:portal` / `sponsors:manage` /
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

1. **Participant challenge-selection form + "max challenges per project" +
   "freeze participant edits at a deadline."** H20 states participants cannot
   modify their project, team, or challenges at all ("*No puedo modificar nada de
   esto yo mismo*"); corrections flow through operators (H21). In-hackOS project
   creation and participant self-service (H18/H19) are explicitly marked
   *post-MVP*. Building a participant-facing selection/limit/lock flow would
   contradict the story, so the participant surface stays read-only.
2. **Generic challenge Create/Delete CRUD.** Challenges are created and owned
   through the sponsor lifecycle (H43/H44), not an admin CRUD table. The module
   exposes read/edit/versions/panel; there is no create or delete endpoint, and
   the "prevent delete when linked" rule is moot because deletion isn't a story.
3. **`is_active` filter.** No such column exists. Activation is `status` +
   `visibility` + `available_from` (H45). Public/list reads filter on those.

The genuinely-additive request that *was* actionable — this architecture
document — is what you are reading.
