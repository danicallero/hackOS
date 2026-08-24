# Queue groups (H46)

The grouping layer between an enterprise's challenges and the rooms/queues that
judge them. Added by `apps/api/db/migrations/0410_queue_groups.sql`; rooms were
repointed onto it by `0411_room_queue_groups.sql`.

> **Status: routing live, merging not yet.** Rooms, queue reads, ordering and
> the room-assignment admin screen all go through queue groups. Every group is
> still 1:1 with a challenge, because nothing can create a shared group yet —
> the merge UI is the remaining piece, and until it ships the product behaves
> exactly as one-queue-per-challenge did.

## Why

A room used to judge exactly one challenge (`room_challenges`, unique per room
since `0401`), and each challenge had its own queue. The target model is that
rooms serve an **enterprise**, and each enterprise decides which of its
challenges share one judging queue and which get their own. A queue group is
that unit: one enterprise, 1..N of its challenges, one display name.

Putting the group between "challenge" and "room/queue" keeps
`queue_entries.challenge_id` — and therefore every per-challenge invariant,
including `UNIQUE(challenge_id, repo_id)` and H30's one-active-entry-per-repo
index — completely untouched. Grouping changes which `challenge_id`s feed a
room's queue and what that queue is called; it does not change what a queue
entry *is*.

## Tables

```
                     ┌──< room_queue_groups >── rooms  (UNIQUE room_id)
enterprises ──< queue_groups ──< queue_group_challenges >── challenges
                (display_name)     (challenge_id UNIQUE)
```

- **`queue_groups`** — `enterprise_id`, `display_name`, `created_by`,
  timestamps (with the standard `set_updated_at` trigger).
- **`queue_group_challenges`** — `(queue_group_id, challenge_id)`, primary key
  on the pair, **`UNIQUE` on `challenge_id` alone**. That unique is the hard
  invariant: a challenge belongs to at most one group, ever — either its own
  1:1 group or a shared one, never both. `ON DELETE CASCADE` on both FKs, so
  deleting a group releases its challenges and deleting a challenge leaves no
  orphan membership.
- **`room_queue_groups`** — `room_challenges` renamed and repointed by `0411`:
  `(room_id, queue_group_id)`, `assigned_at`, `assigned_by`, still `UNIQUE` on
  `room_id`. A room serves one group, so the enterprise a room judges for is
  derived (`room_queue_groups → queue_groups.enterprise_id`) rather than stored
  a second time. A room with no row is unassigned, exactly as before.

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

2. **Every challenge has exactly one group.** `challenges_default_queue_group`
   (`AFTER INSERT ON challenges`) creates a 1:1 group for each new challenge,
   with `display_name` defaulting to the challenge title. It lives in the
   database rather than the challenges service so seeds, imports, and direct
   SQL cannot bypass it — `0411`'s repoint of `room_challenges` onto
   `queue_group_id` (and its `NOT NULL`) depends on the invariant holding for
   every row created in the meantime.

Because of (2), "challenge without a group" is never a state the rest of the
system has to special-case, and nothing is merged automatically: today's
per-challenge queue behaviour is exactly what N separate 1:1 groups describe.
Merging challenges into a shared group is an explicit admin action, shipped
later.

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

### Room assignment

`POST /api/queue/rooms/:roomId/queue-group` and
`DELETE /api/queue/rooms/:roomId/queue-group/:queueGroupId` replace the old
room→challenge routes; `GET /api/queue/groups` lists the groups the caller may
assign. Permission is the same grant as the enterprise judge roster
(`assertCanManageEnterpriseJudging`: `queue:admin`, `sponsors:manage`, or a rep
of the group's enterprise) — and reassigning a room away from another
enterprise's group requires the grant on *both* enterprises.

## Not yet done

- Nothing can create a shared (N>1) group: the merge UI, the group
  `display_name` editor, and the judging-criteria merge a shared group needs
  are the remaining work. Until then every group is 1:1.
- `display_name` does not follow a renamed challenge. Read surfaces work
  around this by showing the member challenge's live title for a 1:1 group and
  only falling back to `display_name` once a group has more than one
  challenge.
- Surfaces that still label a room with a single challenge (the judging
  panel's read-only header, `roomPace`'s presentation ceiling) pick the
  group's lowest challenge id. That is the room's only challenge today; a
  merged group should show the group name and aggregate limits instead.
