# Queue groups (H46)

The grouping layer between an enterprise's challenges and the rooms/queues that
judge them. Added by `apps/api/db/migrations/0410_queue_groups.sql`; rooms were
repointed onto it by `0411_room_queue_groups.sql`; `0413_room_enterprises.sql`
split "which enterprise a room belongs to" off from "which queue it serves".

> **Status: complete.** Rooms, queue reads, ordering, the room-assignment
> screen and the merge action all go through queue groups. An enterprise with
> more than one challenge can merge selected challenges into one or more shared
> queues from its judges tab; each challenge starts in a 1:1 group and behaves
> exactly as one-queue-per-challenge did until an explicit merge.
>
> **Room ownership is a separate decision from room serving (0413).** A room's
> enterprise (`room_enterprises`) and a room's serving queue
> (`room_queue_groups`) used to be the same fact, read one way. They no longer
> are: an admin assigns a room to an enterprise once (Rooms admin page,
> `/queue/rooms`), and — only when that enterprise runs exactly one queue —
> the server wires the room to serve it automatically. An enterprise running
> several queues gets no automatic link; which of its pooled rooms serves
> which queue is decided per-queue from that queue's own page (Judging queues
> → a queue → Rooms), by admins and the enterprise's own reps alike. A room
> can be pooled into an enterprise while serving none of its queues — the
> enterprise may hold more rooms than it currently needs.

## Why

A room used to judge exactly one challenge (`room_challenges`, unique per room
since `0401`), and each challenge had its own queue. The target model is that
rooms serve an **enterprise**, and each enterprise decides which of its
challenges share a judging queue and which get their own. Different subsets of
an enterprise's challenges may form different shared queues. A queue group is
that unit: one enterprise, 1..N of its challenges, one display name.

Putting the group between "challenge" and "room/queue" keeps
`queue_entries.challenge_id` — and therefore every per-challenge invariant,
including `UNIQUE(challenge_id, repo_id)` and H30's one-active-entry-per-repo
index — completely untouched. Grouping changes which `challenge_id`s feed a
room's queue and what that queue is called; it does not change what a queue
entry *is*.

## Tables

```
room_enterprises >── rooms ──< room_queue_groups >── queue_groups
(UNIQUE room_id)                (UNIQUE room_id)      │
      │                                                │
      └──────────────────< enterprises >───────────────┘
                                │
                    queue_group_challenges >── challenges
                       (challenge_id UNIQUE)
```

- **`queue_groups`** — `enterprise_id`, `display_name`, `created_by`,
  timestamps (with the standard `set_updated_at` trigger).
- **`queue_group_challenges`** — `(queue_group_id, challenge_id)`, primary key
  on the pair, **`UNIQUE` on `challenge_id` alone**. That unique is the hard
  invariant: a challenge belongs to at most one group, ever — either its own
  1:1 group or a shared one, never both. `ON DELETE CASCADE` on both FKs, so
  deleting a group releases its challenges and deleting a challenge leaves no
  orphan membership.
- **`room_enterprises`** (0413) — `room_id` (PK), `enterprise_id`,
  `assigned_at`, `assigned_by`. A room belongs to at most one enterprise at a
  time. This is the room-pool/ownership fact, set from the Rooms admin page
  (admin-only) and independent of whether the room is currently serving any
  of that enterprise's queues.
- **`room_queue_groups`** — `room_challenges` renamed and repointed by `0411`:
  `(room_id, queue_group_id)`, `assigned_at`, `assigned_by`, still `UNIQUE` on
  `room_id`. A room serves at most one group at a time. Before 0413 the
  enterprise a room judged for was *derived* from this table
  (`room_queue_groups → queue_groups.enterprise_id`); now it must belong to
  the enterprise the room is pooled into (`room_enterprises`) — enforced by
  the `room_queue_groups_enterprise_guard` constraint trigger (0413). A room
  with no row here is pooled but not currently serving anything, or not
  pooled at all.

## Invariants enforced in the database

1. **A group never spans enterprises.** Every member challenge's owning
   enterprise (`challenges.author → sponsors.enterprise_id`) must equal
   `queue_groups.enterprise_id`. A plain FK cannot express that cross-table
   equality, so it is a deferrable `CONSTRAINT TRIGGER`
   (`queue_group_enterprise_guard`) on inserts/updates of
   `queue_group_challenges` and on `queue_groups.enterprise_id` updates. It
   raises `check_violation` (SQLSTATE `23514`).

   Constraint triggers rather than `BEFORE` row triggers on purpose: a group
   and its first member row are legitimately written by a single statement
   (the backfill below), which a `BEFORE` trigger's snapshot would not see.

   Re-pointing `challenges.author` at a sponsor of another enterprise would
   break the same invariant from the other side; there is no product surface
   for that today, so it is deliberately not guarded.

2. **Managed challenge creation gives every challenge one group.**
   `challenges_default_queue_group` (`AFTER INSERT ON challenges`) creates a
   1:1 group for each new challenge, with `display_name` defaulting to the
   challenge title. The membership row is `ON DELETE CASCADE`, so a direct
   group deletion, an interrupted reset, or hand-written legacy SQL can leave
   an ungrouped challenge. Those malformed rows are not silently treated as a
   real queue: marker-aware reads omit them and queue mutations fail closed;
   release checks must repair them before serving traffic.

With a valid membership row, nothing is merged automatically: today's
per-challenge queue behaviour is exactly what N separate 1:1 groups describe.
Merging challenges into a shared group is an explicit admin action — see
"Merging" below.

## Backfill

The migration ends with a single CTE statement that gives every pre-existing
challenge its 1:1 group, delimited by
`-- >>> backfill:queue_groups_1to1` markers because
`apps/api/test/queue/queue-groups.test.ts` runs that exact SQL against seeded
rows. One statement, not two: the group ids come from the identity sequence up
front (`nextval` + `OVERRIDING SYSTEM VALUE`) so each new group can be carried
back to the challenge that caused it. Matching groups back by
`(enterprise_id, display_name)` would silently collapse two same-titled
challenges of one enterprise into one group.

The statement skips challenges that already have a membership row, so it is
safe to re-run.

## How the group is read (0411)

Every query that used to read `room_challenges.challenge_id` now takes two
hops. The shared SQL fragments and helpers live in
`apps/api/src/modules/queue/groups.ts`:

| Helper | Answers |
|---|---|
| `ROOM_CHALLENGE_IDS_SQL` / `roomChallengeIds` | which challenges a room can call from |
| `CHALLENGE_ROOM_IDS_SQL` | which rooms serve a challenge's queue |
| `GROUP_SIBLING_CHALLENGE_IDS_SQL` | which challenges share a challenge's queue (always includes itself) |
| `roomEnterpriseId` / `queueGroupEnterpriseId` | which enterprise a room/group belongs to |

Consumers: `queue/reads.ts`, `queue/rooms.routes.ts`, `queue/entries.routes.ts`,
`queue/notify.ts`, `queue/service.ts`, `queue/contextual-access.ts` and
`challenges/service.ts`.

### Ordering

`queue_entries.position` is now scoped to the **queue group**, not the
challenge (`queue/ordering.ts`): a shared queue is one ordering key space, so
`nextTopPosition`/`nextBottomPosition`/`compactQueueGroupPositions` take their
min/max across every challenge in the group. Callers still pass a
`challengeId` — that is what a queue entry carries — and the group is resolved
from it. For a 1:1 group the bounds select exactly the rows the per-challenge
bounds did, so ordering is unchanged.

### Call once

A repo that applied to several of a group's challenges still has one
`queue_entries` row per challenge, but it is **one line item**: both
`callNextForRoom` and the room's waiting-queue read drop a repo's sibling
entries once any of them is called, in a room, or completed within the same
group. The filter can never match for a 1:1 group, so today's queue and
candidate ordering are byte-identical.

### Room assignment (0413)

Two separate route pairs now cover what one used to:

- **`POST`/`DELETE /api/queue/rooms/:roomId/enterprise`** — pools a room into
  an enterprise (`room_enterprises`), or takes it out. Global-admin only
  (`queue:admin`); a sponsor rep manages their queue's challenges and judges
  but never which physical rooms belong to their company. Assigning also
  resolves the room's serving queue automatically: if the enterprise runs
  exactly one `queue_groups` row, the room is wired to serve it
  (`room_queue_groups`) in the same request; if it runs zero or several, no
  serving link is created (an existing one is cleared instead of left
  pointing at a queue outside the new enterprise). Unassigning clears both
  the pool membership and the serving link.
- **`PUT /api/queue/groups/:queueGroupId/rooms`** — points a *queue* at the
  rooms that serve it, chosen from `GET /api/enterprises/:id/assignable-rooms`
  (which now returns exactly the enterprise's pooled rooms, not "unassigned
  rooms"). Same grant as the judge roster
  (`assertCanManageEnterpriseJudging`: `queue:admin`, `sponsors:manage`, or a
  rep of the group's enterprise) — so an enterprise with several queues
  routes each of its pooled rooms to whichever queue it wants, including
  using only some of them, from here rather than from the Rooms admin page.

`GET /api/queue/groups` still lists the groups the caller may see/manage
queue-side (challenges, judges, criteria) — unrelated to who may *pool* a
room, which is admin-only regardless of caller.

## Merging (0412)

Merging is the only thing that produces a group with more than one challenge.
It lives in `queue/group-merge.ts` behind five routes, all gated by the same
grant as the judge roster (`assertCanManageEnterpriseJudging`: `queue:admin`,
`sponsors:manage`, or a rep of the enterprise):

| Route | Does |
|---|---|
| `GET /api/enterprises/:id/queue-groups` | every queue the enterprise runs, with challenges, rooms, merged form and whether judging started |
| `POST /api/enterprises/:id/queue-groups/preview-merge` | the merged judging form these challenges would produce, writing nothing |
| `POST /api/enterprises/:id/queue-groups/merge` | performs the merge |
| `POST /api/enterprises/:id/queue-groups/:queueGroupId/split` | gives every member challenge its own 1:1 group back |
| `PATCH /api/queue/groups/:queueGroupId` | the admin's review: the shared name and the merged form |
| `POST /api/queue/groups/:queueGroupId/generate` | appends newly eligible projects for every member challenge, preserving existing active positions |
| `DELETE /api/queue/groups/:queueGroupId/entries` | clears waiting/called entries before the first evaluation while preserving the queue group and its configuration |

`GET /api/queue/groups` is the cross-enterprise version of the first row and
backs both the room-assignment picker and the all-queues management view: a
`queue:admin`/`sponsors:manage` caller gets every queue on the platform, a
sponsor representative only their own enterprises', anyone else none.

Queue generation is deliberately incremental. It resolves each member
challenge's Devpost prize tags, appends only projects without an active entry,
and uses the queue ordering service for every insertion, so regenerating never
renumbers a team that is already waiting, called, or evaluated. Clearing a
queue cancels only waiting/called entries and records the clear action; a later
generation can restore entries cleared by that action at the end. Clearing is
refused after the first evaluation or while a team is in a judging room.

The merge itself, in one transaction:

1. **Locks every one of the enterprise's `queue_groups` rows, lowest id
   first.** Merge and split both move memberships between an enterprise's
   groups and renumber positions across them, so concurrent calls have to
   serialise; a fixed lock order means two overlapping merges cannot deadlock.
2. **Refuses a group spanning enterprises.** The database already refuses it
   (0410's constraint trigger); the service check exists so the caller gets a
   400 instead of a `23514`.
3. **Locks affected queue entries, then refuses once judging has started** — a
   submitted `attempt_review` or a `completed` entry gives a 409. Merely being
   called or presenting does not freeze configuration. Review submission and
   manual completion take the same queue-group-then-entry lock order, so a
   structural edit cannot pass a stale check while the first evaluation is
   committing.
4. **Moves the memberships** onto the group of the lowest challenge id
   (arbitrary but stable, so a retry lands on the same group).
5. **Hands the absorbed groups' rooms over** before deleting them. The
   `room_queue_groups` FK is `ON DELETE CASCADE`, so skipping this would
   silently unassign those rooms.
6. **Compacts positions across the merged group** — each challenge numbered
   its own queue from 1, so merged rows collide until they are renumbered into
   the group's single key space.
7. **Stores the merged judging form** (below) and writes one `audit_log` row.

## The merged judging form

`queue_groups.judging_panel_criteria` (0412) holds a shared queue's single
form. `NULL` means "resolve the member challenge's own
`challenges.judging_panel_criteria`", which is every 1:1 group — so nothing
about a single-challenge enterprise's scoring changes.

`criteria-merge.ts` folds the member panels into it: a de-duplicating union in
author order, where two questions are the same question when their labels
match in **any** of `en`/`es`/`gl` after case/whitespace/accent/trailing-
punctuation normalisation, or (for a question with no label) when their keys
match. Keys are preserved wherever possible, since `attempt_review.scores` is
keyed by them; only a key claimed by two genuinely different questions is
renamed (`nota` → `nota-2`). Nothing semantic is attempted — the admin's
review step is what catches near-misses, and the merge is refused after
judging starts precisely so no existing answer can be orphaned by a rename.

Everything that reads a panel resolves through the group: `judging.ts`'s
answer validation, `reviews.ts`'s overview and detail, `exports.ts`'s CSV
columns, and `roomView`'s `challenge.judging_panel_criteria`, which is what
the web judging panel renders. A judge therefore fills exactly one form per
called team, whichever of the group's challenges that team applied to.

## Naming

0412 also makes `display_name` trustworthy on its own: a trigger keeps a
**solo** group's name following its challenge's title, and a merged group's
admin-chosen name is never overwritten by a challenge rename. Every read
surface reads `display_name` unconditionally (`QUEUE_GROUP_LABEL_SQL` in
`groups.ts`) — the room label, the reviews overview, the participant's "my
queue", the TV. For a 1:1 group that is the challenge title, exactly as before.

The TV clusters rooms by `queue_group_id` rather than challenge id, so several
rooms working one shared queue are a single card.

## Where this lives in the UI

Per `docs/DESIGN.md` §7 (additive capability-gated workspaces, no new
top-level areas) and §5 (sub-views are a `TabBar`, not another nav item),
queue management is **not** a new destination. Queue operations (`/queue`,
Live judging workspace) carries a two-tab `TabBar` — two projections of one
thing:

- **Rooms** — the room-keyed cards that were already there: live queue,
  team search, per-entry actions.
- **Queues** — queue-group-keyed (`queues-panel.tsx`): every queue in the
  caller's scope with its name, challenges, serving rooms, progress and team
  lookup, plus the naming and shared-vs-per-challenge controls. **A queue no
  room serves is only reachable here**, which is why the room-keyed tab alone
  was not enough.

The page keeps one `PageHeader` and one primary action ("Generate queues")
across both tabs (§4).

Naming and merging deliberately do **not** live on the enterprise profile: an
admin would have to know which enterprise to open first, and one destination
must not have two homes (§4).

Room → **enterprise** pooling lives on `/queue/rooms` (admin-only, `queue:admin`,
0413) — a venue-planning decision, not a judging one. Room → **queue** linking
(routing an enterprise's pooled rooms to its specific queues, including
**unlinking** a room an enterprise would rather leave idle) stays queue-side,
on a queue's own page (Judging queues → a queue → Rooms), reachable by both
`queue:admin` and the enterprise's own reps.

## Deliberately not aggregated

`roomPace`'s presentation-time ceiling resolves a merged group to its **lowest
challenge id** and uses that challenge's limit. That is a product decision, not
a gap: limits are **never** summed, averaged, or otherwise combined across a
group's challenges. If a merged group ever needs a single number, it picks one
member's — don't replace this with anything computed from the set.
