# API request admission and priorities

The API has a small, in-process admission scheduler for finite HTTP work. It
limits how many non-streaming requests can execute at once when the process is
busy, and chooses which waiting request runs next. This is a resilience and
latency policy (H8, H540, #544), not an authorization mechanism: capability
guards still decide whether the request is allowed to perform the operation.

The scheduler is local to one API process. An external load balancer may
distribute requests across API replicas, but replicas do not share an
admission queue.

## The decision order

For each non-streaming request subject to admission, the API does the
following before the route handler runs:

1. Classify the URL and method into a traffic lane (`P0`–`P3`).
2. For an authenticated user, read the maximum `roles.position` from that
   user's assigned, non-deleted roles. A user with several roles uses the
   highest one. A user with no assigned live role has no role position.
3. Try to acquire an admission slot. If an eligible slot is available, the
   request starts immediately; running requests are never preempted.
4. Otherwise, add the request to the wait queue, unless the bounded P2/P3
   queue is full.
5. Whenever a slot is released, select the eligible waiter by:

   1. highest role position first;
   2. lane rank (`P0`, then `P1`, then `P2`, then `P3`) when role priority is
      equal;
   3. arrival order within the same role position and lane.

Role position is a numeric priority, not a weight. A position of `19,000`
beats `5,000`; it does not receive more than one slot or make the request run
in parallel. A missing role position is lower than every persisted position,
including negative positions from migrated roles.

The role position is a snapshot taken while the request is entering
admission. Reordering or removing a role does not reorder a request that is
already waiting. A failed role lookup falls back to the request's lane, so an
optional priority lookup cannot turn into an authorization or availability
outage.

## What each lane is for

Lanes describe the work being requested. They do not describe the caller's
role and do not grant access. A request can still return `401`, `403`, `404`,
or another application response after it receives a slot.

| Lane | Worth protecting | Current classification |
| --- | --- | --- |
| **P0** | Event-critical operations that keep queues, rooms, accreditation, presence, and activities moving during the live event. | `/api/queue/**`, except participant self-queue paths and queue review/session/entry-stream paths; `/api/logistics/**`, `/api/accreditation/**`, `/api/activities/**`, and `/api/scanner/**`. The operational `queue` SSE topic, logistics SSE, and audit SSE are owned by this lane for metrics, although all SSE bypass admission. |
| **P1** | Staff collaboration and operational work that is important but less time-critical than a live call or scan: reviews, project/challenge administration, exports, applications, and event/content management. | Queue review/session/entry-stream paths, `/api/queue/reviews`, `/api/challenges/**`, `/api/enterprises/**`, `/api/projects/**`, `/api/repos/**`, `/api/announcements/**`, `/api/schedule/**`, `/api/exports/**`, `/api/event/**`, and `/api/applications/**`. Authenticated SSE topics for review, projects, sponsors, exports, applications, identity, and synthetic queue fixtures are owned by this lane for metrics. An unrecognized `/api/events/stream` topic also falls back here. |
| **P2** | Public and display traffic that should remain available but can tolerate delay during an operational surge: public content, TV reads, and anonymous GET traffic. | `/api/public/**`, public announcements, content stream, TV reads/stream, and anonymous GET requests that do not match a more specific class. `/healthz`, `/readyz`, and `/metrics` bypass admission entirely. Public TV/content SSE topics are owned by this lane for metrics. |
| **P3** | Best-effort personal traffic and traffic most likely to be amplified by participant refreshes or authentication flows. | `/api/queue/me/**`, `/api/me/**`, `/api/auth/**`, authenticated requests without a more specific classification, and anonymous non-GET requests without a more specific classification. Per-user SSE topics are owned by this lane for metrics. |

The classifier is intentionally path-based and conservative. It is evaluated
before route authorization, so adding a capability does not silently change a
request's lane. The source of truth for the exact matcher is
`apps/api/src/lib/request-lanes.ts`.

## Capacity, reservation, and shedding

The scheduler's maximum active work is the API process's `DB_POOL_MAX` value;
it does not resize the PostgreSQL pool. The application default is `20` in
development/production and `5` in tests, unless `DB_POOL_MAX` is configured.
Each API replica has its own active and waiting counts.

The default reserved capacity is:

```text
min(DB_POOL_MAX - 1, ceil(DB_POOL_MAX / 4))
```

In other words, roughly one quarter of the process's slots is protected from
role-less P2/P3 traffic. The application also bounds the number of waiting
P2/P3 requests to:

```text
max(16, DB_POOL_MAX × 8)
```

When that waiting bound is reached, a new P2/P3 request receives `429` with a
one-second retry hint. P0/P1 requests are not rejected by this best-effort
queue bound.

The reservation works as follows:

- P0/P1 requests can use any free slot.
- A role-bearing P2/P3 request can use any free slot, so its role position can
  compete with operational requests according to the priority order above.
- A role-less P2/P3 request can use only the non-reserved portion. This leaves
  room for P0/P1 traffic when anonymous/public work is occupying the process.
- No request can exceed the total active-slot limit, and no request can
  interrupt one already running.

For example, with `DB_POOL_MAX=20`, the default reservation is five slots and
the P2/P3 wait queue can hold 160 requests. Role-less public traffic can fill
at most 15 active slots; the remaining five stay available for P0/P1. A user
with a live role participates in the role-ordered scheduler and can use all 20
slots, subject to the total limit and any queued higher-priority work.

## Role examples

Role priority follows the live role hierarchy, not role names or capability
count. With positions such as `Event Director = 18,700`, `Organizer = 5,000`,
and `Participant = 500`, a queued Event Director request is selected before a
queued Organizer request, which is selected before a queued Participant
request. This remains true even when the requests use different lanes; the
lane only breaks a role-priority tie.

If a user holds both `Participant` and `Organizer`, only the highest assigned
live position (`Organizer`) is used. Hidden roles still participate because
hierarchy position is independent of display visibility; soft-deleted roles
do not participate.

## Requests outside the scheduler

Long-lived SSE requests never hold an admission slot. They remain governed by
the SSE connection budgets and slow-client backpressure in `sse.ts`. Their
lane is still calculated so connection and request metrics retain consistent
priority-lane ownership.

Rate limiting is a separate Valkey-backed control. It can reject a request
before the handler regardless of admission priority; admission priority does
not bypass endpoint rate limits, capability checks, idempotency checks, or
route policy.

The main metrics are low-cardinality and lane-based:

- `hackos_http_requests_total`
- `hackos_http_request_admission_wait_seconds`
- `hackos_http_request_admission_queue_size`

Role IDs, user IDs, and raw role positions are deliberately not Prometheus
labels.
