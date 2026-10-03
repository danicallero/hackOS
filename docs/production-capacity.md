# Production capacity and operations

This is the operational contract for a production event with up to 500
concurrent browser/mobile connections. It is intentionally more concrete than
the product stories: it describes the resource ceilings, traffic channels,
priority policy, failure behaviour and the signals an operator should use
while diagnosing an event.

## Resource contract

Production uses one API, one worker, one PostgreSQL primary, one Valkey node,
one MinIO node and one web container. The hard ceilings are declared in
`deploy/docker-compose.yml`; they are not environment-variable overrides.

| Service | RAM ceiling | Swap ceiling | Purpose and pressure signal |
|---|---:|---:|---|
| PostgreSQL | 5 GiB | 1 GiB | Durable source of truth; watch database connections, lock waits, query timeouts and container OOM events. |
| Valkey | 2 GiB | 1 GiB | SSE pub/sub, BullMQ, rate limits and ephemeral TV state; watch used/max memory, evictions, reconnects and queue backlog. |
| API | 2 GiB | 1 GiB | Fastify HTTP/SSE, auth, validation and JSON work; watch RSS, heap, event-loop lag, 5xx and admission wait. |
| Worker | 2 GiB | 1 GiB | BullMQ processors, outbox delivery, queue ticks and wallet sync; watch its worker metrics endpoint and logs. |
| MinIO | 1 GiB | 1 GiB | S3-compatible assets and exports; watch storage/IO and upload errors. |
| Web | 1 GiB | 1 GiB | Next.js rendering and runtime configuration; watch web logs and host memory. |

The declared production RAM total is 13 GiB and the declared service swap
total is 6 GiB. Host swap is a burst safety valve, not extra RAM: sustained
swap activity is a capacity incident because it increases latency and can
still exhaust the host. The Incus `hackos` container remains host-managed and
unlimited; Docker supplies the service-level ceilings above.

### How container RAM reaches Grafana

Every service reports the Linux cgroup v2 accounting for **its own**
container: total RAM charged, inactive file cache, calculated working set,
RAM/swap ceilings, and memory-limit/OOM counters. API and worker publish their
own readings directly. PostgreSQL, Valkey, MinIO and web run the same small
reader as their unprivileged container user and atomically write a JSON sample
to a private tmpfs volume; API mounts those four volumes read-only and
republishes the values through its existing `/metrics` endpoint.

This is deliberately not a host exporter: it does not use the Docker socket,
does not install a host service, does not open a port, and does not grant a
container visibility into another container's cgroup. The short-lived
`metrics-init` Compose job copies the static reader into the ordinary
`metrics-tools-v2` named volume as UID 1000; it has no network or capabilities.
The executable survives the helper exiting. Only JSON samples use small,
non-executable tmpfs volumes. The versioned tools volume replaces the original
1 MiB/noexec volume without deleting it or touching database/storage volumes.
A sample older than 45 seconds is removed from Prometheus rather than shown as zero or as healthy
historical data.

`memory.current` includes filesystem cache because that cache counts against
the service limit. The dashboard therefore shows both total charge and
`memory.current - inactive_file` (working set). Neither figure should be
called PostgreSQL's private heap: PostgreSQL's shared buffers and kernel cache
are real memory pressure even though they are not a per-query allocation.

PostgreSQL starts with `shared_buffers=1GB`,
`effective_cache_size=4GB`, `work_mem=8MB`, `maintenance_work_mem=256MB` and
`max_connections=100`. The 5 GiB limit is a hard container ceiling, not a
promise that PostgreSQL will reserve all 5 GiB. Do not increase
`max_connections` to solve HTTP pressure; recompute the pool budget first.

## Connection and request model

The browser and mobile apps communicate with the API over HTTPS. They do not
connect directly to PostgreSQL, Valkey or MinIO.

1. A normal read or mutation is one finite HTTP request. Mutations carry an
   idempotency key and are committed in PostgreSQL transactions.
2. Live queue, logistics, TV and collaboration views hold an SSE connection.
   SSE carries a small invalidation/event envelope; clients refetch the
   authoritative read model rather than receiving a full state copy.
3. The web broker shares one authenticated fetch/SSE connection per tab across
   independently authorized logical scopes.
   Matching events invalidate the exact browser read-model key and refetch
   once after a short debounce. If SSE is unavailable, live views poll every
   15 seconds and revalidate after a background tab resumes.
4. Mobile uses the same API contract, keeps one in-flight read per cache key,
   persists a namespaced offline read cache, and retries after connectivity
   returns. SSE-backed polls run only while their scope is disconnected.

For 500 concurrent connections, the default budgets allow up to 2,000 local
SSE connections globally, 500 per topic and 20 per authenticated client. That
leaves room for a participant using a browser and mobile device, plus staff
and TV connections. The per-topic ceiling is intentional: one public stream
cannot consume the entire process.

Finite HTTP work is admitted separately from SSE. With `DB_POOL_MAX=24`, the
API gate allows 24 active database-backed requests, reserves 6 slots for P0/P1
operational work, and bounds the P2/P3 waiting queue at 192. SSE does not hold
an admission slot for its lifetime.

The database connection arithmetic is:

```text
(1 API × 24) + (1 worker × 24) + 12 operational = 60 < PostgreSQL max_connections 100
```

The 12-connection allowance covers migration, health, administration and
superuser headroom. A second API or worker replica changes this equation and
must be reviewed before it is added.

## Priority channels

| Lane | Traffic | Behaviour under pressure |
|---|---|---|
| P0 | Queue transitions, room operations, accreditation, presence and live scanning | Protected first; inspect lock waits and P0 latency before changing pool size. |
| P1 | Review, projects, applications, exports, schedule and staff collaboration | Protected below P0; may queue behind P0 but is not intentionally shed. |
| P2 | Public catalogue, public content, TV and anonymous GET reads | Best effort; can receive bounded `429` responses while preserving P0/P1. |
| P3 | Participant self-service, personal reads and authentication | Best effort; bounded queue and rate limits prevent refresh storms from starving operations. |

Valkey outage behaviour is deliberately asymmetric: PostgreSQL remains the
source of truth; SSE publication becomes best effort and clients refetch;
rate limiting fails open and emits a metric; TV falls back to rooms; BullMQ
reconnects with its durable work state still represented by PostgreSQL/outbox
rows. This is availability under a single-node broker failure, not automatic
Valkey high availability.

## Valkey/cache policy

Valkey is a shared transient broker, not a correctness cache:

| Key/channel | Role | Retention/failure policy |
|---|---|---|
| `sse:<topic>` | Pub/sub fan-out to local API processes | No durable state; reconnect and refetch on loss. |
| `sse:seq:<topic>` | Gap detection IDs | Seven-day sliding TTL; old topics disappear. |
| `bull:*` | BullMQ scheduling and jobs | Must not be evicted; the database/outbox remains the recovery boundary. |
| `ratelimit:*` | Distributed fixed-window limits | TTL keys may be evicted under pressure; the API fails open and reports it. |
| `tv:mode` | Ephemeral screen override | Missing/malformed state means the default rooms display. |

The production command sets `maxmemory=1536mb` and `volatile-lru`: only keys
with an expiry are candidates for eviction, protecting BullMQ and other
non-expiring coordination keys. The 2 GiB container ceiling leaves room for
Valkey overhead and a short swap burst. Eviction count, keyspace misses and
reconnects are operational alerts; increasing the limit without checking the
host budget is not a cache strategy.

The browser/mobile caches reduce duplicate reads at the edge, but they never
replace PostgreSQL and are invalidated on identity changes, matching SSE
events, mutations and recovery reads. This keeps availability high without
serving an unbounded stale server-side cache.

## Notifications and mail diagnostics

Notification rows are durable in `notification_outbox`. The worker claims one
row per transaction with `FOR UPDATE SKIP LOCKED`, sends through the configured
SMTP relay, marks success as `sent`, retries transient failures with backoff,
and parks permanent failures as `failed` with a redacted error message.

The worker now reuses a bounded SMTP connection pool (five connections, 100
messages per connection) and records relay recipient rejection as a permanent
dispatch outcome. Grafana shows queued and failed outbox rows, worker sends,
rejections and SMTP-related logs.

An SMTP `sent` row means the relay accepted the message; it is not proof that
the recipient mailbox accepted it. A later bounce is provider state. For the
current infrastructure, inspect the Mailcow Prometheus metrics and Loki logs
for `bounce`, `reject`, `defer` and `deliver`. If production points directly
at Amazon SES instead, SES bounce/complaint events still need an SES event
destination or webhook before they can be counted as application metrics.

## Grafana and alert interpretation

The shared infrastructure monitoring instance already runs Prometheus, Loki
and Grafana at `grafana.gpul.org`. The provisioned `HackUDC V · hackOS
production · operations` dashboard adds:

- explicit scrape/dependency state and a six-service RAM/swap/OOM table;
- application-only request rate, 5xx count, p95 by priority lane, SSE,
  admission queue and event-loop lag;
- PostgreSQL connection state, Valkey data/cache activity, and guard values
  that disappear when collection fails rather than pretending to be zero;
- email-only outbox depth, age, overdue retry time and worker outcomes;
- structured API errors plus hackOS-only service logs. Historical
  `ECONNREFUSED` records are visible but are not presented as current state.

The existing shared Grafana database and dashboards remain untouched. The
dashboard is the only new Grafana dashboard provider, versioned at
`instances/monitoring/grafana/dashboards/hackos-production.json` in the
infrastructure repository; the existing Prometheus and Loki data sources are
reused by name.

### Finding production logs in the existing Grafana

Logs follow `container stdout/stderr → Docker Loki logging driver →
monitoring:3100/loki/api/v1/push → Loki → Grafana's existing Loki data source`.
There is no separate Promtail/Alloy agent for these Docker streams. Docker's
default logging driver applies when a container is created; inspect the
container's `HostConfig.LogConfig`, not only `docker info`, when diagnosing
an older container.

In Grafana Explore, select **Loki**, use the last 24 hours initially, and run:

```logql
{host="hackos",compose_project="hackos-production"}
```

To narrow the stream, add `compose_service="api"`, `"worker"` or `"web"`.
The existing Incus lifecycle/logging panels filter `app="incus"` and show
host events, not hackOS application output. The HackUDC V dashboard is a
local configuration until its deployment is approved.

API logs use Pino JSON with numeric levels. Loki may expose
`detected_level="unknown"`; do not rely on that label to find API errors.
Parse the JSON instead:

```logql
{host="hackos",compose_project="hackos-production",compose_service="api"}
  | json | __error__="" | level >= 50
```

Level 40 includes warnings, 50 errors and 60 fatal errors. For worker output,
which may be plain text, begin with the unfiltered stream before applying a
text search. A quiet service can have no entries in a short time window even
when delivery is working.

Interpret signals together:

| Symptom | First checks | Likely action |
|---|---|---|
| 5xx + event-loop lag | API RSS/limit, GC, request p95, Loki | Reduce refetch amplification or add API capacity only after DB budget review. |
| SSE rejections/disconnects | SSE by lane/topic, Valkey connected/evictions | Check client reconnect storm and topic distribution; do not blindly raise the global ceiling. |
| DB waiters/lock waits | P0/P1 latency, PostgreSQL connections/max, query timeouts | Fix hot query/lock or shed P2/P3; do not raise pools past the connection equation. |
| Outbox queued age rising | Worker `/metrics`, sent/rejected outcomes, SMTP logs | Verify relay, then add a worker replica or increase batch only after duplicate-send review. |
| Memory current near limit | Service RAM/working-set/cache, swap, OOM events and request latency | Treat swap as temporary; raise only the specific service after load evidence. |
| Mail `sent` but users report no mail | Mailcow/SES bounce and deferred logs | This is provider delivery state, not an API retry problem. |

## Release and rollback policy

The production host stores `.image-tags` as the deployed image identity and
`.release-policy` as promotion policy. A successful explicit SHA deployment
from the operator shell or workflow with `release_action=rollback` writes a
hold. The automatic five-minute updater exits while that hold exists. A
successful `latest` operator deployment or workflow with
`release_action=promote` clears it. A failed deployment does not change the
hold, so a failed attempt cannot accidentally re-enable promotion.

The hold is host-local and contains only mode, SHA, reason and timestamp. It
must be included in host backups/runbooks; it is not an application secret.

## Qualification gate

Before applying this profile, run the representative event-day harness with
500–600 synthetic participants and at least 500 simultaneous SSE connections.
Capture `/metrics`, worker metrics, Compose stats, PostgreSQL lock/connection
state and Valkey memory/eviction counters before, during and after the run.
The change is ready only when P0/P1 budgets pass, no service reaches its RAM
ceiling, swap remains a short burst rather than a sustained working set, and
the notification backlog drains instead of growing.

## Multiplexed realtime transport (#892)

Authenticated web/native readers share `/api/realtime/stream` with independently
authorized logical scopes, per-topic cursors and scoped authoritative recovery.
TV retains one public payload-free stream for all rendered domains. Legacy
endpoints remain available for installed clients. Physical connection budgets
and gauges count the shared response once; logical attachments and access-check
load remain separate. See [realtime transport](./realtime-transport.md) for the
scope/authorization table, lifecycle, revocation, metrics and 600-client results.
