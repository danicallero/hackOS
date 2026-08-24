# Queue operator console

The **Rooms** tab in Queue operations is the room-first console for queue
operators. It shows only unpaused rooms, then answers the operational questions
in order: which teams are in each waiting room, and which team is coming next?
Sponsor queue configuration remains in the **Queues** tab and the queue detail
route.

Each room card contains the room name, its queue name, one numbered **Waiting
room** list, and a single **Coming next** entry. Room state, location, waiting
area counts, and queue positions are intentionally omitted because the
operator is already looking at the active room's operational view.

**Remind waiting room** stays visible on a called team row and repeats the
original “come to room X and wait” notification without asking the team to
enter. **Notify room entry** is the separate participant notification for
telling a team to enter the judging room and lives in the row's overflow menu.
The overflow trigger sits in the top-right corner of each team card, keeping
the numbered name and its visible action easy to scan.
Adding a team to a waiting area, prioritising it, or sending it to the end of
the queue are exceptional actions shown in the team lookup when the row has
room for them.

The search icon beside the Rooms / Judging queues tabs opens a shared team
lookup. It searches the teams currently visible to the operator, then loads
every active queue membership for the selected team, including its position,
plain-text queue status, and approximate call time when available. Position
changes and other exceptional queue actions remain visible inline: move the
team to the top, send it to the end, or (for queue administrators) disqualify
it. Adding a waiting team to a judging room uses one compact dropdown
containing every room that serves that queue, so a shared queue can be routed
to the correct room without making the row wider for each room.
The normal room board remains focused on arrivals rather than calling teams.
The inline actions follow the judging-panel safety rules: a team already in a
waiting room is not offered another waiting-room call; a team being evaluated
cannot be reordered; and queue actions are blocked while one of the team's
members is actively being evaluated in another room. The API enforces the
same guard inside the transaction, so a stale screen cannot bypass it.

## Data contract

The board consumes the live `RoomView[]` projection returned by
`GET /api/tv/rooms` through `getAllRoomViews()`. It deliberately searches the
projection already on screen instead of calling the per-challenge search API.
That matters for shared queues: `RoomView.next` is already deduplicated by the
queue group, while a per-challenge search would miss teams belonging to the
other challenges in that group.

Waiting entries are deduplicated with `challenge.queue_group_id` plus
`repo_id`. A waiting team is shown once, with every room serving that group as
its destination. Active and called entries remain attached to their concrete
room because those states are room-specific.

## Operator actions

The board is capability-gated by `QUEUE_OPERATE` (or `QUEUE_ADMIN`) and uses
the existing audited entry actions:

- notify a called team that it can enter the judging room;
- remind a called team to come to the waiting room again;
- manually send an exceptional waiting team to a room's waiting area;
- prioritise a team or send it to the end of the queue;
- disqualify a team from the team lookup (queue administrators only);
- requeue or mark a called team absent.

Every mutation uses a fresh idempotency key and refreshes the live projection
after success. The board does not edit queue names, judging forms, or room
assignments; those sponsor/admin operations belong to the queue configuration
and detail surfaces in PR #528. Queue ordering still goes through the existing
audited position engine.

## Integration boundary

When this branch is combined with `danicallero/shared-queue-merge`, keep the
`Queues` tab and replace only the Rooms-tab `RoomQueueCard` grid with
`QueueOperatorConsole`. The shared-queue field required by this screen is
`RoomView.challenge.queue_group_id`.
