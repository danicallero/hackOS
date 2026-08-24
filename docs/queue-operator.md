# Queue operator console

The **Rooms** tab in Queue operations is the arrival board for queue
operators. It answers one question quickly: which team needs attention, and
which judging room can receive it? Sponsor queue configuration remains in the
**Queues** tab and the queue detail route.

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

- notify a called team again;
- send a waiting team to the waiting room for its destination room;
- move a waiting team to the top;
- requeue or mark a called team absent.

Every mutation uses a fresh idempotency key and refreshes the live projection
after success. The board does not edit queue names, judging forms, room
assignments, or queue positions directly; those sponsor/admin operations belong
to the queue configuration and detail surfaces in PR #528.

## Integration boundary

When this branch is combined with `danicallero/shared-queue-merge`, keep the
`Queues` tab and replace only the Rooms-tab `RoomQueueCard` grid with
`QueueOperatorConsole`. The shared-queue field required by this screen is
`RoomView.challenge.queue_group_id`; no additional operator endpoint is
needed.
