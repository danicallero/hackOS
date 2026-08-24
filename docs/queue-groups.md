# Queue groups (H46)

The grouping layer between an enterprise's challenges and the rooms/queues that
judge them. Added by `apps/api/db/migrations/0410_queue_groups.sql`.

> **Status: schema only.** No API route, service, or UI reads these tables yet.
> The migration is inert plumbing — behaviour is identical to before it ran.
> The consumers (rooms pointing at a group instead of a challenge, and the
> merged queue ordering) land in follow-up PRs.

## Why

Today a room judges exactly one challenge (`room_challenges`, unique per room
since `0401`), and each challenge has its own queue. The target model is that
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
   SQL cannot bypass it — the follow-up migration that repoints
   `room_challenges` onto `queue_group_id` depends on the invariant holding
   for every row created in the meantime.

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

## Not yet done

- `room_challenges` still points at `challenge_id`. Repointing it to
  `room_queue_groups.queue_group_id`, and the two-hop join rewrites in
  `queue/reads.ts`, `queue/rooms.routes.ts`, `queue/entries.routes.ts`,
  `queue/notify.ts`, `queue/service.ts` and `challenges/service.ts`, are the
  follow-up PR.
- `display_name` does not follow a renamed challenge; that only becomes
  visible once something renders group names.
- Queue-group configuration UI (merge challenges, name the group) and the
  merged queue ordering/`position` scoping are later work again.
