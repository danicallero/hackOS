# Room/judging → enterprise-scoped redesign

Story id `Hxx` is a placeholder until I assign a real one (new story, or an
amendment note on H46) — don't invent one, ask me if it's still unresolved
when you get to it.

## What I want

Remove room assignments for judges. A room is accessible to all of an
enterprise's judges and representatives, not just some. Enterprises can add
judges from outside their own enterprise.

For enterprises with more than one challenge, admins decide whether that
enterprise runs a single shared judging queue across its challenges or one
queue per challenge. A shared queue has one judging panel and one queue-list
entry, named by admins (e.g. "ACME's Challenges" instead of listing "Challenge
A", "Challenge B", "Challenge C" separately) — not one entry per challenge,
even if a team applied to more than one of that enterprise's challenges. Room
assignments change to link rooms to enterprises, not challenges; enterprises
pick which of their rooms serve which queue themselves. Enterprises with only
one challenge get this auto-filled to that single challenge — they never see
a "shared vs per-challenge" choice.

A team can be prize-selected on any challenge from a shared queue as long as
the team was evaluated somewhere in that shared queue — not only on the exact
challenge they technically applied to.

## Answers, in case you ask

- Call each team once through a shared queue, not once per challenge it
  applied to. The judging form is the same for every challenge in a shared
  queue; if challenges already had separate forms before being merged, merge
  the questions instead of duplicating them.
- Adding a judge (including an outside one) is silent — no invite or consent
  step, same as today's room-judge assignment.
- A judge who's also staff/admin elsewhere needs no special handling —
  judge membership is purely additive to whatever they already have.
- Shared-queue merging doesn't pool room capacity. Each room keeps its own
  waiting-area cap; grouping only changes which challenges feed a room's
  queue.
- A shared queue can never span challenges from different enterprises. Enforce
  this with a real DB constraint, not just a service-layer check.
- Opt-out isn't possible once judging has started. Also check whether
  opt-out even exists yet in the codebase before worrying about how it
  interacts with shared queues — I don't think it's built.
- No per-challenge judge restriction inside a shared queue. A judge added to
  an enterprise can judge anything that enterprise runs.

## Schema

`enterprise_judges(enterprise_id, user_id, added_by, added_at)` — replaces
the judge half of `room_judges`. No `challenge_id`: a judge is available to
every room the enterprise controls, not filtered per challenge. A judge
doesn't need to already be a `sponsors` rep of that enterprise — an enterprise
can add anyone.

`queue_groups(id, enterprise_id, display_name, created_by, created_at,
updated_at)` plus `queue_group_challenges(queue_group_id, challenge_id
UNIQUE)` — a challenge belongs to at most one queue group ever, enforced by
`UNIQUE` on `challenge_id` alone. Every challenge gets its own 1:1 group by
default (`display_name` defaults to the challenge title), so "no group" is
never a state anything has to special-case. An admin later merges N of an
enterprise's groups into one shared group as an explicit action.

`room_challenges` gets repointed rather than replaced: rename to
`room_queue_groups`, swap `challenge_id` for `queue_group_id`. A queue group
always belongs to exactly one enterprise, so "which enterprise does this room
serve" is just `queue_groups.enterprise_id` through this link — don't add a
separate `room_enterprises` table, that'd be a second source of truth.

`queue_entries.challenge_id` stays untouched, and so does its
`UNIQUE(challenge_id, repo_id)`. A shared queue is a display/ordering/routing
layer above `challenge_id`, not a replacement for it — see "queue mechanics"
below for why.

`challenge_winners` stays untouched too, schema-wise. Winners still record
against a specific `challenge_id`; only the eligibility check for who can be
picked expands.

Drop `room_judges` last, after everything below is cut over — not before.

## Migration order

1. Create `enterprise_judges`, backfill from `room_judges` joined through
   `room_challenges` → `challenges` → `sponsors` (challenge's owning
   enterprise). If the same person judged for two different enterprises
   historically, that's fine — it produces two rows, which is correct under
   the new model. If they judged multiple rooms for the *same* enterprise,
   `added_by`/`added_at` provenance on the backfilled row is approximate
   (audit metadata only, doesn't affect behavior) — say so in the migration
   comment.
2. Create `queue_groups` + `queue_group_challenges`, auto-fill one group per
   existing challenge (1:1). Do this with a single CTE/RETURNING chain that
   carries `challenge_id → new queue_group.id` directly rather than two
   separate statements trying to re-match rows afterward — matching by
   `display_name` is fragile if two challenges from the same enterprise share
   a title.
3. Repoint `room_challenges` → `room_queue_groups` using the groups from step
   2 — since every challenge got exactly one group, this is lossless with no
   judgment calls.
4. Drop `room_judges` once every consumer listed below is migrated off it.

Rooms that served no challenge before get no `room_queue_groups` row either —
same "unassigned room" state as today, just against `queue_group_id`.

## Access control

Everywhere access currently checks `room_judges`, check `enterprise_judges`
against the relevant challenge's owning enterprise instead — drop the room
indirection entirely, since a judge is no longer bound to a room. The specific
places I know need this (grep for `room_judges` to catch what I've missed,
this list might be stale by the time you implement it):

- `apps/api/src/modules/queue/contextual-access.ts`: `judgesChallenge`
  becomes enterprise-derived directly. `judgesRoom` and its callers
  (`requireRoomJudgeOrCapability`, `requireRoomAccessOrCapability`,
  `accessibleRoomIds`) resolve through `room_queue_groups → queue_groups →
  enterprise_judges` instead of a direct room link.  `requireRoomJudgeManager`
  becomes `requireEnterpriseJudgeManager`, taking an `enterpriseId` (not
  derived from a room anymore) and checking `QUEUE_ADMIN` or
  `ownsEnterprise`. Judge roster management becomes an enterprise-scoped
  route, not a room-scoped one.
- `apps/api/src/modules/identity/role.ts` — the judge-role derivation swaps
  its `room_judges` existence check for `enterprise_judges`.
- `apps/api/src/modules/projects/access.ts`,
  `apps/api/src/modules/challenges/access.ts`,
  `apps/api/src/modules/challenges/service.ts` (the assigned-judge-challenges
  listing, and the room_queue_state update that finds rooms serving a
  challenge) — same swap pattern, enterprise-derived instead of room-derived.
- `apps/api/src/modules/queue/reads.ts`, `notify.ts`, `service.ts`,
  `entries.routes.ts` — every `room_challenges` read becomes a two-hop join
  through `room_queue_groups → queue_group_challenges`. `notify.ts` and
  `service.ts` currently resolve a room to a single `challenge_id`; once a
  room can serve a shared group, that becomes a list — check every call site,
  this is a real scalar→array type change, not just a join rewrite. The
  "which rooms can a waiting team be called into" logic needs to expand from
  "rooms serving this challenge" to "rooms serving this challenge's queue
  group" — that's the actual point of the shared queue, but it also means the
  participant-facing "where do I go" messaging needs the expanded room list.
- `apps/api/src/modules/logistics/{scanner-sync,stats,accreditation}.ts` —
  same swap, no other change.
- `apps/api/src/modules/sponsors/access.ts` — keep judges deliberately
  excluded from sponsor-portal access, exactly like `room_judges` was. Adding
  someone to `enterprise_judges` should not grant them sponsor-FAQ access.
- `apps/api/src/modules/queue/rooms.routes.ts` — remove the room-scoped judge
  routes entirely (`POST/DELETE /api/queue/rooms/:roomId/judges`, `GET
  .../judge-candidates`); replace with enterprise-scoped equivalents under
  `/api/enterprises/:id/judges`. Keep the judge-candidate pool unscoped (any
  user, no enterprise filter) — that's already how it works today, and it's
  what "outside judges" requires.

## Queue mechanics for a shared queue

Keep a display-layer merge — don't restructure `queue_entries`. A team
applying to 2 of an enterprise's 3 grouped challenges still gets up to 2
separate `queue_entries` rows, one per challenge it actually applied to; the
`UNIQUE(challenge_id, repo_id)` constraint doesn't move. What changes is
purely how those rows get read, ordered, and acted on together:

- Reads for a shared-group room query across every challenge_id in the group,
  ordered by one shared key space (`position` scoped to the `queue_group_id`,
  not per-challenge).
- `call_next`'s H30 guarantee (never call a team with a member occupied
  elsewhere) doesn't need to change — it already operates per-repo across all
  of a repo's queue entries regardless of challenge_id.
- A team with entries in two challenges of the same group gets called once,
  not twice, per my answer above. Don't create a second visible line item for
  the same repo within one group — dedupe at the service/read layer so
  judges see and fill exactly one form per team.

Restructuring `queue_entries` itself (nullable `queue_group_id`, dropping
`challenge_id NOT NULL`) isn't worth it — it would force every current
per-challenge query, including the ones for the overwhelmingly common
single-challenge-enterprise case, to become group-aware for a purely cosmetic
win. The display-merge approach means single-challenge enterprises need zero
changes to their `queue_entries` handling.

## Judging form unification for a shared queue

When challenges merge into a shared queue, the judging panel's scoring form
becomes one shared form for every challenge in the group — not N independent
forms. If the merged challenges already had their own separate criteria, run
a de-duplicating union (match by normalized question text) into one canonical
set stored against the `queue_group_id`, and let the admin review/edit the
merged result before the group goes live. Judges then fill exactly one form
per called team, regardless of which challenge(s) in the group they applied
to.

## Prize selection

Wins still record per-`challenge_id` into the existing `challenge_winners`
table — no new group-level winners concept, no schema change. What expands is
eligibility: for a challenge that belongs to a queue group, a repo is
eligible if it has a completed queue history against *any* challenge in that
group, not just the exact one being scored. The winner still gets written
against whichever specific `challenge_id` the sponsor is scoped to when they
make the pick — if a repo has entries against multiple challenges in the
group, ask which challenge_id to attribute the win to, since
`challenge_winners` still needs exactly one per row.

Don't introduce a group-level winners table — that would fork "who can see
this win" and "how prizes export" into two parallel paths for no functional
gain, since every win still belongs to one sponsor-visible challenge in the
end.

## UI surfaces needed

- Enterprise judge roster (add/remove/list `enterprise_judges`) — search
  needs to span all users, not just existing reps of that enterprise.
- Room ↔ enterprise assignment, replacing today's room → challenge picker.
- Enterprise queue-group configuration (only shown to enterprises with >1
  challenge): toggle shared vs per-challenge, pick which challenges join a
  shared group, set its `display_name`, pick which rooms serve it. A group
  can only ever hold challenges from its own enterprise.
- Swap the challenge name for the group's `display_name` everywhere a queue
  currently shows a challenge title (queue list, TV screens, "my queues") —
  once a challenge belongs to a >1-challenge group. No visible change for the
  default 1:1 case.
- Judging-criteria merge review step, part of the queue-group configuration
  screen, per the judging-form-unification section above.
- Prize/winners screen: for a shared-group challenge, scope the picker to the
  group and let the sponsor attribute each win to a specific challenge_id
  when a repo has multi-challenge entries.
- Mobile: no new admin screens needed (sponsor/admin flows stay web-only).
  Just verify the participant "where do I go" screen renders the expanded
  room list correctly once a challenge's possible rooms come from its queue
  group instead of a single challenge_id — don't let any mobile-side
  assumption bake in "one challenge = its own room set."

Keep UI copy minimal per the usual house rule — headings and controls should
speak for themselves, no explanatory text unless it's covering risk,
consequence, or a genuinely unfamiliar rule.

## Build it in this order

1. **`enterprise_judges` + access control off `room_judges`.** Keep today's
   1-queue-per-challenge / 1-room-per-challenge behavior completely
   unchanged — this is a pure backend/data-model swap. Move the judge
   management UI to enterprise-scoped since its old routes disappear. Ship
   this alone first; nothing about queue ordering or prizes is at risk in
   this step.
2. **Room→enterprise/queue_group linking + admin UI**, still always 1:1 (no
   "merge into shared group" UI yet) — just the repointed FKs and the new
   room-assignment screen. Depends on step 1. Product behavior still looks
   like "one challenge, one queue" the whole way through.
3. **The actual shared/merged queue + admin-chosen naming.** Group-scoped
   position ordering, the two-hop-join expansions, call-once dedupe, and the
   judging-criteria merge. This is the highest-risk step — it touches the
   live `call_next` path and position-assignment logic, both
   concurrency-sensitive, so give it the fullest concurrency/idempotency test
   coverage. Depends on step 2. Consider gating it so a broken merge can't
   affect the common single-challenge case (e.g. don't let a `queue_groups`
   row exceed 1 challenge until explicitly enabled per-enterprise).
4. **Cross-challenge prize eligibility.** Just the eligibility-check
   expansion and the winners-screen picker extension — no schema change, no
   concurrency surface. Depends on a shared group existing to have any
   effect, but is otherwise low-risk and can trail behind step 3 by any
   margin.

## Status

| Step | PR | Branch | Notes |
| --- | --- | --- | --- |
| 1 | [#521](https://github.com/danicallero/hackOS/pull/521) | `worktree-agent-a2e636846de634c59` | merged into integration branch |
| 2 | [#522](https://github.com/danicallero/hackOS/pull/522) | `danicallero/queue-groups-schema` | merged into integration branch |
| 4 | [#523](https://github.com/danicallero/hackOS/pull/523) | `danicallero/challenge-winners-queue-group` | merged into integration branch — turned out to only need step 2, not step 3 |
| 3 | [#524](https://github.com/danicallero/hackOS/pull/524) | `danicallero/room-queue-group-routing` | merged into integration branch |

All four merged into `feature/room-judging-enterprise-redesign`.
[#526](https://github.com/danicallero/hackOS/pull/526) is the draft PR from
that branch into `main` — merge order was 1 → 2 → 4 → 3 (4 didn't end up
needing 3). Pending: full combined test suite on the integration branch
before taking #526 out of draft.

Also filed, found along the way but deliberately not fixed here (pre-existing,
not introduced by this work): [#525](https://github.com/danicallero/hackOS/issues/525)
— `call_next`'s unique-violation backstop can't actually recover
mid-transaction without a savepoint.
