# API request admission and priorities

The API has a small, in-process admission scheduler for finite HTTP work. It
limits how many non-streaming requests can execute at once when the process is
busy, and chooses which waiting request runs next. This is a resilience and
latency policy (H8, H540, #544), not an authorization mechanism: capability
guards still decide whether the request is allowed to perform the operation.

The scheduler is local to one API process. Caddy sends traffic to the single
API in the canonical runtime, and any future replicas would not share an
admission queue.

The pre-event qualification is a disposable load-test stack with an isolated
database and Valkey instance; it is torn down after each run. Its `api` and
`worker` memory limits and `DB_POOL_MAX` mirror production, so a passing
`validation.releaseBudgetPassed` result exercises the release under the same
request-admission ceiling. The default fixture rounds the event up to 600
participants, 35 staff, 30 sponsor representatives, 12 rooms and 7 queues,
including 3 shared queues.

## The decision order

For each non-streaming request subject to admission, the API does the
following before the route handler runs:

1. Classify the URL and method into a traffic lane (`P0`–`P3`).
2. Try to acquire an admission slot. If an eligible slot is available, the
   request starts immediately; running requests are never preempted.
3. Otherwise, add the request to the wait queue, unless the bounded P2/P3
   queue is full.
4. Whenever a slot is released, select the eligible waiter by:

   1. lane rank (`P0`, then `P1`, then `P2`, then `P3`);
   2. arrival order within the same lane.

The HTTP hook deliberately does not query PostgreSQL to calculate role priority
before admission. That lookup would let an authenticated burst consume the
same database-pool capacity the gate protects. Capability checks still enforce
authorization in the route handler; admission lanes are a resilience policy,
not a security boundary. The scheduler's optional role-position overload remains
covered by its direct unit contract for callers that already have that value.

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
development, `24` in production, and `5` in tests, unless `DB_POOL_MAX` is
configured. The production Compose file and qualification stack set 24
explicitly. Each API replica has its own active and waiting counts.

The default reserved capacity is:

```text
min(DB_POOL_MAX - 1, ceil(DB_POOL_MAX / 4))
```

In other words, roughly one quarter of the process's slots is protected from
all P2/P3 traffic, including authenticated participant and sponsor requests.
The application also bounds the number of waiting P2/P3 requests to:

```text
max(16, DB_POOL_MAX × 8)
```

When that waiting bound is reached, a new P2/P3 request receives `429` with a
one-second retry hint. P0/P1 requests are not rejected by this best-effort
queue bound.

The reservation works as follows:

- P0/P1 requests can use any free slot.
- P2/P3 requests can use only the non-reserved portion. This leaves room for
  P0/P1 traffic when participant, sponsor, anonymous, or public work is
  occupying the process; the reservation is lane-based rather than dependent
  on whether a user has a role.
- No request can exceed the total active-slot limit, and no request can
  interrupt one already running.

For the event-day baseline `DB_POOL_MAX=24`, the default reservation is six
slots and the P2/P3 wait queue can hold 192 requests. P2/P3 traffic can fill at
most 18 active slots; the remaining six stay available for P0/P1. Lane rank
and arrival order select queued requests within the eligible capacity, and a
participant or sponsor cannot consume the reserved P0/P1 share merely because
they have a persisted role. The six slots are concurrent finite-request
capacity, not a one-slot-per-staff reservation. Staff P0/P1 requests use the
protected lanes, so queued staff work wins the next available slot while the
scheduler leaves already-running requests alone.

At one API and one worker, the matching database pool calculation is
`(1 × 24) + (1 × 24) + 12 operational connections = 60`, below the stock
`max_connections=100`. Recompute this expression before adding replicas or
raising `DB_POOL_MAX`; the 12-connection allowance covers migration,
maintenance, administration and superuser use.

### `DB_POOL_MAX` decision tree

Use 24 as the event-day baseline and inspect the following metrics together:

1. If P2/P3 `429` rate or either lane's
   `hackos_http_request_admission_queue_size{lane="P2"}` /
   `hackos_http_request_admission_queue_size{lane="P3"}` rises while Postgres
   connection count, pool waiting, P0/P1 latency and container memory remain
   healthy, keep 24 when the traffic is best-effort. Raise it only for a
   verified finite-throughput need, after recomputing the connection budget
   and rerunning qualification.
2. If `pg_stat_activity` approaches 88 connections, lock waits grow, or
   `hackos_db_pool_waiting` rises, do not raise the pool. Reduce the burst or
   investigate the slow query/lock holder first.
3. If the Postgres container reports OOM, lower pool/concurrency and redo the
   memory calculation before changing `max_connections`.
4. If P0/P1 waits while P2/P3 is shed, retain 24 and inspect the operational
   query path and the six reserved slots. A `429` on P2/P3 is preferable to
   allowing best-effort work to exhaust the finite-request guardrail.

### Changing a memory limit

Edit the relevant Compose limit, recreate only that service, and verify health;
change the mirrored qualification limit in the same review:

```sh
# edit deploy/docker-compose.yml (and qualification when the service is mirrored)
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml up -d --force-recreate <service>
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml ps <service>
```

Rerun `deploy/qualification/validate-compose.mjs` and inspect
`validation.releaseBudgetPassed` after the change.

## Role examples

The direct scheduler contract also accepts a caller-supplied role position for
contexts that already have a trusted snapshot: higher positions are selected
first and the lane breaks ties. The HTTP admission hook does not obtain that
snapshot with a database query; it uses the lane-only behavior described above
so admission itself cannot create database pressure.

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
