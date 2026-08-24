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

The main action is **They're here**. It is a shared operational note, not a
queue transition: every operator sees the acknowledgement on the numbered
waiting-room row. **Notify room entry** is the separate participant
notification for telling a team to enter the judging room. Adding a team to a
waiting area, prioritising it, or sending it to the end of the queue are
exceptional actions behind the row's overflow menu.

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

The shared `queue_operator_arrival_ack` table stores the door acknowledgement
for a currently-called entry. It is intentionally not a `queue_history` row:
the team has not changed queue state. Acknowledgements are audited and emitted
on the authenticated queue SSE stream, so two operator consoles converge. The
acknowledgement is removed when the entry is called again and is automatically
out of the read model after the team leaves `called`.

## Operator actions

The board is capability-gated by `QUEUE_OPERATE` (or `QUEUE_ADMIN`) and uses
the existing audited entry actions:

- notify a called team that it can enter the judging room;
- acknowledge that a called team is physically at the waiting-area door;
- manually send an exceptional waiting team to a room's waiting area;
- prioritise a team or send it to the end of the queue;
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
`RoomView.challenge.queue_group_id`. The console also reads
`GET /api/queue/operator-arrivals` and writes
`POST /api/queue/entries/:entryId/operator-arrival`; both are capability-gated
and the write is audited.
