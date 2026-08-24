# Big-event readiness (~600 concurrent users)

A practical checklist for sizing and validating a deployment before an event
with several hundred concurrent participants (registration rush, badge
scanning at doors, live queue/judging screens). The architectural reasoning
behind *why* this topology scales lives in
[`architecture.md` §7 Scalability](./architecture.md#7-scalability); this doc
is the concrete "what do I set / check before doors open" companion.

## What already scales without changes

- **api is stateless and horizontally scalable.** SSE (queue/TV/judging
  live updates) fans out through Valkey pub/sub
  ([`architecture.md` §5](./architecture.md#5-realtime-sse-fanned-out-through-valkey)),
  so any number of `api` replicas behind Traefik see every event — a client
  connected to replica A gets updates published by replica B.
- **worker is safe to scale by replica count.** Notification dispatch and
  state-machine ticks (queue pump, expirer) use
  `FOR UPDATE` / `FOR UPDATE SKIP LOCKED`, so N replicas split the work with
  no double-processing.
- **Idempotency + concurrency primitives are already in place** for scanners
  and queue transitions (`idempotencyGuard`, `SELECT … FOR UPDATE`) — a
  scanning burst at doors can't double-check someone in.

600 CCU for a hackathon is bursty, not sustained — the load spikes are
registration opening, doors/badge scanning, and queue/judging transitions,
not 600 people hammering the API every second. The checklist below is about
having headroom for those bursts, not steady-state capacity.

## Scaling each service: what it actually relieves

Scaling isn't one lever — each service scales independently and relieves a
different kind of stress. Knowing which one is under pressure (via the
monitoring queries below) tells you which service to scale, rather than
reflexively adding replicas everywhere.

| Service | What scaling it relieves | What it does *not* relieve | How to scale | Recommended for ~600 CCU |
|---|---|---|---|---|
| **api** | Request-handling CPU/event-loop contention — auth checks, Zod validation, JSON serialization, and the number of concurrently-open HTTP/SSE connections a single Node process can service. | Postgres load — every extra `api` replica opens its own `DB_POOL_MAX`-sized pool, so scaling `api` *adds* to Postgres's connection budget, it doesn't reduce query load there. | Add replicas in Dokploy/compose; stateless by design, SSE already fans out through Valkey (§ above) so no sticky sessions needed. | 1 replica on a 2+ vCPU box comfortably covers 600 CCU. Add a 2nd only if you observe sustained CPU saturation on the box, not preemptively. |
| **worker** | `notification_outbox` drain latency (mass announcements, acceptance emails) and state-machine tick backlog (queue pump, confirmation expirer, wallet sync). The drain is a repeatable BullMQ job (`every: 5s`) that queues a new occurrence regardless of whether the previous one finished, so under real backlog multiple ticks queue up and `FOR UPDATE SKIP LOCKED` lets replicas split them safely. | Nothing HTTP-facing — the worker has no ingress, so it never helps with request latency or SSE capacity. Replicas also don't help an *empty* queue drain faster — see the mass-messaging section below for why batch size, not replica count, is the first lever. | Add replicas; no coordination needed beyond what's already in the query. | 1 replica for steady-state. See "Mass-messaging bursts" below for what to do specifically before a 600+-recipient, multi-channel send. |
| **postgres** | The one thing that's genuinely shared: query latency and lock-wait time on `FOR UPDATE` transitions (queue calls, scan idempotency, badge rotation). This is the resource `api` and `worker` replicas both draw down, not build up. | Nothing about it "scales" by adding replicas — it's a single primary by design (§7 architecture.md), so more Postgres capacity means a *bigger* box, not more of them. | Vertical: raise `PG_MEM_LIMIT`, put `pgdata` on NVMe, give it dedicated CPU (see the host-splitting section below if it's contending with `api`/`worker`/`web` for CPU). | `PG_MEM_LIMIT=2g`+ if the host has it; this is the service most worth over-provisioning, since every other service's scaling ultimately funnels load into it. |
| **valkey** | SSE pub/sub fan-out throughput and BullMQ job enqueue/dequeue throughput. | Nothing durable — it holds no source-of-truth data, so scaling it is about pub/sub message rate, not correctness. | Single-node by design; not a lever worth reaching for at this scale — Valkey handles orders of magnitude more throughput than 600 CCU produces. | Leave at defaults (`VALKEY_MEM_LIMIT=512m`); this is not where event-day stress shows up. |
| **minio** | Object upload/download throughput — application file attachments, sponsor logo serving, export downloads, wallet-pass assets. | Nothing else — it's not on the query/lock-wait path at all. | Single-node; if you outgrow it, repoint `S3_ENDPOINT`/`S3_PUBLIC_URL` at managed S3/R2/Spaces (§7 architecture.md) rather than trying to cluster MinIO yourself. | Default (`MINIO_MEM_LIMIT=1g`) is fine for steady use; only worth bumping if you expect a simultaneous upload burst (e.g. a submission deadline with large project files). |
| **web** | Next.js SSR/page-render load for the browser app and TV screens — each connected TV/participant browser holds a request the Node process has to render. | Nothing on the API/DB side — `web` calls the public API URL like any other client, it never touches Postgres directly. | Add replicas behind Traefik; stateless, no session affinity needed (auth lives in the API, not in `web`). | 1 replica is normally enough for 600 CCU; bump `WEB_MEM_LIMIT` if you see OOM restarts under concurrent page loads rather than adding a replica first. |

The practical takeaway: **`api` and `worker` replicas trade Postgres headroom for their own headroom** — they don't create capacity, they redistribute where the bottleneck shows up. If the monitoring queries below show Postgres itself under pressure (active connections near the ceiling, or long lock waits), scaling `api`/`worker` further makes it worse, not better — that's the signal to size Postgres up (or split it onto its own host) instead.

## Mass-messaging bursts (e.g. an announcement to 600+ attendees on 2-3 channels)

This is a different kind of stress from steady CCU — it's a single admin
action that inserts hundreds or thousands of rows into `notification_outbox`
at once (600 recipients × 3 channels = up to 1800 rows). Worth its own plan
because the naive fix ("autoscale the worker on outbox depth") is more
infrastructure than the problem needs — Dokploy/plain Compose has no
built-in autoscaler watching a custom Postgres metric, and this load is
**triggered deliberately by an admin at a known moment**, not an
unpredictable spike.

**The math.** The outbox dispatcher drains `NOTIFICATION_OUTBOX_BATCH_SIZE`
(default `100`) rows every 5s (`dispatcher.ts`). 1800 rows ÷ 100 per tick ×
5s ≈ **1.5 minutes** to fully drain with a single worker replica and an
empty starting backlog.

**Why 100 is a safe permanent default, not a per-event toggle.** Each row is
dispatched and committed in its **own transaction**
(`claimAndDispatchOne` in `dispatcher.ts`) — the batch size only controls
how many of these independent claims one tick loops through, it does not
batch them into a single transaction. That means a worker crash mid-tick
(OOM-kill, a dropped DB connection) only risks a duplicate send for the one
row that was mid-dispatch when it died, regardless of whether the batch size
is 20 or 100 — raising it doesn't grow the blast radius. This is also why
you don't need to remember to change it before a known mass-send: it's
already sized for one.

**If you still see backlog building during a very large send:** watch the
outbox-depth query below. If it's climbing rather than draining even at
batch 100, that means a single tick's total dispatch work now regularly
exceeds 5s (plausible with three real channel adapters × 100 rows of network
I/O) — at that point a second `worker` replica helps, since the next tick's
job queues up while the first is still running and `SKIP LOCKED` lets the
second replica pick it up. This is a fallback for an unusually large send,
not something to do by default.

## What to configure for the event

| Setting | Where | Default | Recommended for ~600 CCU |
|---|---|---|---|
| `DB_POOL_MAX` | `api` + `worker` env | `20` each | `20`–`30` each is plenty; see the Postgres budget below before going higher. |
| `API_MEM_LIMIT` | `api` compose | `512m` | `1g` if running a single `api` replica; keep `512m` per replica if you scale out instead (see below). |
| `WORKER_MEM_LIMIT` | `worker` compose | `512m` | Usually fine as-is — the worker is a light tick drainer, not request-serving. |
| `PG_MEM_LIMIT` | `postgres` compose | `1g` | `2g`+ if the host has it to spare — Postgres benefits from memory more than any other service here. |
| `api` replica count | Dokploy / compose | 1 | 1 is fine up to ~600 CCU on a reasonably sized box (2+ vCPU). Add a 2nd replica only if you see sustained CPU saturation — Traefik's `loadbalancer.healthcheck` already keeps a not-yet-ready replica out of rotation. |
| `worker` replica count | Dokploy / compose | 1 | 1 is fine; bump to 2 only if `notification_outbox` depth (query below) climbs during the event instead of draining. |
| `NOTIFICATION_OUTBOX_BATCH_SIZE` | `worker` env | `100` | Already sized for a mass-send — see "Mass-messaging bursts" above. No change needed by default. |

**Postgres connection budget.** Every `api`/`worker` process holds its own
pool sized by `DB_POOL_MAX`. Before raising it, check the arithmetic against
Postgres's `max_connections` (default `100` on the stock `postgres:17-alpine`
image used here):

```
(api replicas × DB_POOL_MAX) + (worker replicas × DB_POOL_MAX) + a few (migrate, ops) < max_connections
```

At the defaults (1 api + 1 worker, `DB_POOL_MAX=20`) that's ~40 connections
— well under 100, with room to raise `DB_POOL_MAX` to 30–40 per process
without touching Postgres config. Only raise Postgres's own
`max_connections` (via a custom `command:`/config mount) if you're also
adding replicas, since each extra connection costs Postgres memory.

## Pre-event checklist

1. **Set the env vars above** in the Dokploy service screens (or `.env`
   files for a manual compose deploy) a few days before the event, not on
   the day — so a boot-time zod validation failure surfaces early.
2. **Load-test the hot paths**, not the whole API surface — the two places
   that take Postgres row locks and see real event-day bursts:
   - Badge scanning (`idempotencyGuard`-guarded scan routes) — simulate the
     doors-open rush.
   - Queue transitions (`call_next` and friends) — simulate judging/queue
     churn.
   A quick way to do this without adding new tooling: point
   [`autocannon`](https://github.com/mcollina/autocannon) or `k6` (either run
   via `npx`/`pnpm dlx`, no need to vendor it into the repo) at a staging
   deploy with realistic concurrency (a few dozen in-flight requests is
   already more than a real scanning line produces at once).
3. **Warm up before doors open.** Hit `/healthz` and a couple of real routes
   right after deploy so the Node process has JIT-warmed the hot paths and
   the `pg` pool has established its connections, instead of doing that cold
   during the first minute of the rush.
4. **Watch these two numbers during the event** (see queries below):
   Postgres active connections (should stay well under `max_connections`)
   and `notification_outbox` queued depth (should hover near zero, not
   climb).

## Monitoring queries

Run these against `postgres` during the event (`docker exec -it <postgres
container> psql -U $POSTGRES_USER -d $POSTGRES_DB`):

```sql
-- Active connections vs. the ceiling
select count(*) as active, current_setting('max_connections') as max
from pg_stat_activity;

-- Outbox backlog — should stay near zero; a climbing number means the
-- worker can't keep up (add a replica, or check LOG_LEVEL=debug worker logs
-- for a stuck channel adapter).
select count(*) from notification_outbox
where status = 'queued' and next_attempt_at <= now();

-- Longest-running query right now — catches an accidental full-table scan
-- or a lock wait before it snowballs.
select pid, now() - query_start as duration, state, query
from pg_stat_activity
where state != 'idle'
order by duration desc
limit 5;
```

## If you need more than this

The levers beyond the table above — PgBouncer, read replicas, worker
autoscaling on outbox depth, partitioning `notification_outbox`/audit — are
for a much larger event than 600 CCU. They're documented in
[`architecture.md` §7](./architecture.md#7-scalability) if you ever need
them; for a single hackathon at this scale, the checklist above is the
complete story.

If co-located Postgres turns out to be the actual bottleneck on the box
you're using (check with the monitoring queries above before assuming this),
[`deploy/README.md`'s "Splitting Postgres onto its own host"](../deploy/README.md#splitting-postgres-onto-its-own-host-optional-advanced)
covers moving it to a second Hetzner server behind a private Cloud Network,
while still managing both from Dokploy.
