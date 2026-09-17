# Big-event readiness (~600 concurrent identities)

A practical checklist for sizing and validating a deployment before an event
with 500+ participants, 30+ staff, 20–30 sponsor representatives, 12 rooms,
and 7 queues (3 shared across rooms/challenges). The architectural reasoning
behind *why* this topology scales lives in
[`architecture.md` §7 Scalability](./architecture.md#7-scalability); this doc
is the concrete "what do I set / check before doors open" companion.

## What already scales without changes

- **api is stateless and ready for a future horizontal topology.** SSE
  (queue/TV/judging live updates) fans out through Valkey pub/sub
  ([`architecture.md` §5](./architecture.md#5-realtime-sse-fanned-out-through-valkey)).
  The canonical multi-architecture runtime deliberately runs one API container
  on both the staging Raspberry Pi and production; a future replica topology would
  still receive every event through Valkey.
- **worker is safe to scale by replica count.** Notification dispatch and
  state-machine ticks (queue pump, expirer) use
  `FOR UPDATE` / `FOR UPDATE SKIP LOCKED`, so N replicas split the work with
  no double-processing.
- **Idempotency + concurrency primitives are already in place** for scanners
  and queue transitions (`idempotencyGuard`, `SELECT … FOR UPDATE`) — a
  scanning burst at doors can't double-check someone in.

The event's roughly 550–560 concurrent identities are mostly held as SSE
connections. HTTP work is bursty rather than one request per identity every
second: the load spikes are registration opening, doors/badge scanning, and
queue/judging transitions. The checklist below is about having headroom for
those bursts, not treating every open SSE connection as a database worker.

## Scaling each service: what it actually relieves

Scaling isn't one lever — each service scales independently and relieves a
different kind of stress. Knowing which one is under pressure (via the
monitoring queries below) tells you which service to scale, rather than
reflexively adding replicas everywhere.

| Service | What scaling it relieves | What it does *not* relieve | How to scale | Recommended for this event shape |
|---|---|---|---|---|
| **api** | Request-handling CPU/event-loop contention — auth checks, Zod validation, JSON serialization, and the number of concurrently-open HTTP/SSE connections a single Node process can service. | Postgres load — every extra `api` replica opens its own `DB_POOL_MAX`-sized pool, so scaling `api` *adds* to Postgres's connection budget, it doesn't reduce query load there. | The canonical Compose runtime has one replica. A future multi-replica Compose project can add stateless API containers; Valkey already fans out SSE, so no sticky sessions are needed. | 1 replica on the production host is the default; keep one on the smaller staging Raspberry Pi. |
| **worker** | `notification_outbox` drain latency (mass announcements, acceptance emails) and state-machine tick backlog (queue pump, confirmation expirer, wallet sync). The drain is a repeatable BullMQ job (`every: 5s`) that queues a new occurrence regardless of whether the previous one finished, so under real backlog multiple ticks queue up and `FOR UPDATE SKIP LOCKED` lets replicas split them safely. | Nothing HTTP-facing — the worker has no ingress, so it never helps with request latency or SSE capacity. Replicas also don't help an *empty* queue drain faster — see the mass-messaging section below for why batch size, not replica count, is the first lever. | Add replicas; no coordination needed beyond what's already in the query. | 1 replica for steady-state. See "Mass-messaging bursts" below for what to do specifically before a 600+-recipient, multi-channel send. |
| **postgres** | The one thing that's genuinely shared: query latency and lock-wait time on `FOR UPDATE` transitions (queue calls, scan idempotency, badge rotation). This is the resource `api` and `worker` replicas both draw down, not build up. | Nothing about it "scales" by adding replicas — it's a single primary by design (§7 architecture.md), so more Postgres capacity means a *bigger* box, not more of them. | The canonical limit is fixed at `2g`; put the persistent volume on fast local storage and size the host appropriately. A larger host requires a reviewed Compose change, not an undocumented env override. | The production host budget reserves the larger database share for 12-room queue-transition contention and the 24-connection per-process baseline. |
| **valkey** | SSE pub/sub fan-out throughput and BullMQ job enqueue/dequeue throughput. | Nothing durable — it holds no source-of-truth data, so scaling it is about pub/sub message rate, not correctness. | Single-node by design; not a lever worth reaching for at this scale — Valkey handles orders of magnitude more throughput than this event's SSE population produces. | Leave the fixed `1g` Compose limit; it gives queue fan-in and connection state room without crowding Postgres. |
| **minio** | Object upload/download throughput — application file attachments, sponsor logo serving, export downloads, wallet-pass assets. | Nothing else — it's not on the query/lock-wait path at all. | Single-node; if you outgrow it, repoint `S3_ENDPOINT`/`S3_PUBLIC_URL` at managed S3/R2/Spaces (§7 architecture.md) rather than trying to cluster MinIO yourself. | The fixed `1g` Compose limit is fine for steady use; a simultaneous upload burst requires host sizing or a reviewed storage change. |
| **web** | Next.js SSR/page-render load for the browser app and TV screens — each connected TV/participant browser holds a request the Node process has to render. | Nothing on the API/DB side — `web` calls the public API URL like any other client, it never touches Postgres directly. | The canonical Compose runtime has one web container behind the host ingress. A future multi-replica topology can add stateless web containers. | 1 replica is the default; keep one on both production and staging. The fixed memory limit is `512m`. |

The practical takeaway: **`api` and `worker` replicas trade Postgres headroom for their own headroom** — they don't create capacity, they redistribute where the bottleneck shows up. If the monitoring queries below show Postgres itself under pressure (active connections near the ceiling, or long lock waits), scaling `api`/`worker` further makes it worse, not better — that's the signal to size Postgres up (or split it onto its own host) instead.

## Mass-messaging bursts (e.g. an announcement to 600+ attendees on 2-3 channels)

This is a different kind of stress from steady CCU — it's a single admin
action that inserts hundreds or thousands of rows into `notification_outbox`
at once (600 recipients × 3 channels = up to 1800 rows). Worth its own plan
because the naive fix ("autoscale the worker on outbox depth") is more
infrastructure than the problem needs — the canonical Compose runtime has no
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

| Setting | Where | Default | Event-day baseline |
|---|---|---|---|
| `DB_POOL_MAX` | `api` + `worker` env | `24` in production Compose | `24` per process: 48 pooled connections across one API and one worker, plus an explicit operational allowance below. |
| `Compose memory limits` | `deploy/docker-compose.yml` | fixed | `postgres=2g`, `valkey=1g`, `minio=1g`, `api=1g`, `worker=1g`, `web=512m`; the declared production sum is 6.5 GiB. |
| `api` replica count | canonical Compose | 1 | 1 is the supported runtime on production and the staging Raspberry Pi. A future multi-replica change must account for the Postgres connection budget below. |
| `worker` replica count | canonical Compose | 1 | 1 is fine; a reviewed Compose topology can add a second worker only if `notification_outbox` depth (query below) climbs during the event instead of draining. |
| `NOTIFICATION_OUTBOX_BATCH_SIZE` | `worker` env | `100` | Already sized for a mass-send — see "Mass-messaging bursts" above. No change needed by default. |

The fixed production memory sum is `2 + 1 + 1 + 1 + 1 + 0.5 = 6.5 GiB` of
declared container limits. It leaves 1.5 GiB below the `<8 GiB` production host
budget for the OS, Docker overhead, and short-lived operational pressure. The
limits are intentionally literals in Compose; they are not environment
overrides.

**Postgres connection budget.** Every `api`/`worker` process holds its own
pool sized by `DB_POOL_MAX`. Before raising it, check the arithmetic against
Postgres's stock `max_connections=100`:

```
(1 api × 24) + (1 worker × 24) + 12 operational connections = 60 < 100
```

The allowance of 12 covers migration, health/maintenance, admin, and
superuser headroom. Keep the stock `max_connections` baseline; the 2 GiB
Postgres limit is reserved for the database working set and connection
overhead, not for an unbounded pool. The qualification check also confirms the
stock `shared_buffers=128MB` setting; keep that and `max_connections=100` until
a reviewed database-memory calculation supports a change. Add replicas only
after recomputing the same expression, and do not raise Postgres's own
`max_connections` without that review.

**Admission baseline.** With `DB_POOL_MAX=24`, the scheduler reserves
`min(23, ceil(24 / 4)) = 6` concurrent slots from all P2/P3 traffic and allows
`max(16, 24 × 8) = 192` queued P2/P3 requests. Those are request slots, not
one slot per identity: SSE connections bypass admission, and P0/P1 staff
requests can use all 24 slots and win queued work by lane rank. The six-slot
reservation protects operational work from participant, sponsor, anonymous,
and public bursts; it is lane-based even when a best-effort user has a
persisted role.

### DB_POOL_MAX decision tree

Use the event-day baseline of 24 per API/worker process and check these signals
before changing it:

1. **P2/P3 `429` rate or wait-queue depth rises while Postgres connections and
   memory are healthy:** first confirm the traffic is best-effort work. If
   P0/P1 latency is healthy, retain 24; if the event genuinely needs more
   finite-request throughput, raise `DB_POOL_MAX` only after recomputing the
   connection expression above and rerun qualification.
2. **Postgres connection count approaches 88, waiters rise, or lock waits
   grow:** do not raise the pool. Reduce burst concurrency, inspect the slow
   query/lock holder, or add capacity through a reviewed topology change.
3. **The Postgres container reports OOM or memory pressure:** lower the pool or
   reduce concurrent workers first; do not raise `max_connections` until the
   database memory budget has been re-sized and qualification passes.
4. **P0/P1 wait-queue depth or latency rises while P2/P3 is being shed:** keep
   the 24 baseline, investigate the P0/P1 query/lock path, and verify that the
   six reserved slots are available. Do not solve an operational bottleneck
   by allowing an unbounded P2/P3 queue.

After any change, rerun the disposable qualification stack and verify
`validation.releaseBudgetPassed` before changing the production Compose file.

### Changing a memory limit

Memory limits are changed in Compose so production and qualification remain
auditable. Edit the service limit in the relevant Compose file, then recreate
that service and verify its health:

```sh
# edit deploy/docker-compose.yml (and qualification if the mirroring value changes)
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml up -d --force-recreate <service>
docker compose --env-file /etc/hackos/hackos.env \
  --env-file /etc/hackos/hackos.secrets \
  -f deploy/docker-compose.yml ps <service>
```

For a qualification-only run, use its `--env-file`/Compose project and verify
the container health before starting the runner. Rerun the Compose validator
after every limit edit.

## Pre-event checklist

1. **Set the two host env files** (`/etc/hackos/hackos.env` and
   `/etc/hackos/hackos.secrets`) a few days before the event, not on the day —
   so a boot-time zod validation failure surfaces early.
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

## Representative event-day load harness (#544)

The repository-owned harness is `apps/api/scripts/event-day-load.ts`. It drives
the real HTTP and SSE routes against a clean local database and reports one
sample per request, grouped by the existing P0/P1/P2/P3 lane classifier. The
fixture is intentionally separate from the normal dev database: by default it
creates 600 participants, 20 operators plus 15 judges (35 staff), 30 sponsor
representatives, 12 rooms, 7 queue groups with 3 shared groups, four TV
clients, one queue entry per participant, one meal activity, and an enterprise
judge roster. The participant/staff/sponsor counts round up the event shape so
a passing run has margin above the expected attendance.
The lane ordering layered onto the route/topic mapping and reserved-capacity
rules is documented in
[`request-admission.md`](./request-admission.md).

The run overlaps participant `GET /api/queue/me` refetches and personal SSE
streams with queue calls, accreditation, meal scans, collaborative review
autosaves, TV refetches, and public/operational SSE streams. It reads
admission-wait histograms, lane queue gauges, SSE connection metrics,
participant invalidation outcomes, and bounded browser refetch observations.
The machine-readable result from the measured run is
[`big-event-readiness-results.json`](./big-event-readiness-results.json).
That checked-in file is a historical local baseline; each qualification run
writes its release-specific artifact to `QUALIFICATION_ARTIFACT_DIR/result.json`
and is the source for the pass/fail decision.

### Clean local recipe

Run this in a terminal with no API test suite or other process using
`hackos_event_day_qualification`; the fixture command drops and recreates that
database schema. Create the disposable database once when using the shared
local Postgres container with the first command below. Run the API process in
a second terminal so the reset completes before the server starts:

```sh
pnpm infra:up
docker compose exec -T postgres createdb -U hackos hackos_event_day_qualification 2>/dev/null || true
pnpm --filter @hackos/api event-day:load -- \
  --mode prepare \
  --database-url postgres://hackos:hackos@localhost:5433/hackos_event_day_qualification \
  --fixture /private/tmp/hackos-event-day-fixture.json

# second terminal, after prepare reports 600 participants / 35 staff / 30 sponsors / 12 rooms / 7 queues (3 shared)
NODE_ENV=test QUALIFICATION_STACK=1 WORKERS_INLINE=true DB_POOL_MAX=24 \
DATABASE_URL=postgres://hackos:hackos@localhost:5433/hackos_event_day_qualification \
VALKEY_URL=redis://localhost:6379/15 PORT=3000 \
pnpm --filter @hackos/api dev

# third terminal, while the API above is healthy
NODE_ENV=test QUALIFICATION_STACK=1 WORKERS_INLINE=true DB_POOL_MAX=24 \
DATABASE_URL=postgres://hackos:hackos@localhost:5433/hackos_event_day_qualification \
VALKEY_URL=redis://localhost:6379/15 \
pnpm --filter @hackos/api event-day:load -- \
  --mode load \
  --fixture /private/tmp/hackos-event-day-fixture.json \
  --duration-seconds 10 \
  --output docs/big-event-readiness-results.json
```

The load command exits non-zero when a P0, P1, or P2 release budget fails. P3
`429` responses and degraded participant refreshes remain in the result because
P3 is explicitly best effort. Run the deterministic in-process harness check
with `pnpm --filter @hackos/api event-day:load -- --mode smoke` before changing
the scenario. Stop the API and run `pnpm infra:down` after the measurement.

### Pre-event production-infrastructure qualification (#544)

Run the full representative workload on the actual production host before
participants use the event, but run it in the repository-owned disposable stack
at [`deploy/qualification/docker-compose.yml`](../deploy/qualification/docker-compose.yml).
The stack has no public ingress, no host ports, one Docker network with
`internal: true`, a fresh Postgres volume, and a fresh Valkey instance. The API
and runner use `NODE_ENV=test` only inside that stack; the runner's
`x-test-user-id` headers can therefore never reach the attendee API. The
fixture contains synthetic `@load.test` accounts and the fixed destructive-safe
database `hackos_event_day_qualification`; `prepare` refuses every other
database name or host, including production/staging databases.

Qualification is a disposable pre-event load-test stack: it has an isolated
database and Valkey instance, uses synthetic accounts, and is torn down after
the artifact is retrieved. It is not a long-running service and never reuses
production state. The stack runs the exact immutable release image in all API,
worker, migration and runner containers. Resource limits are fixed, validated
before startup, and mirror production for the shared services: API/runner 2
CPU + 1 GiB, worker 2 CPU + 1 GiB, Postgres 2 CPU + 2 GiB, Valkey 1 CPU + 1 GiB,
and the disposable migration helper 1 CPU + 512 MiB. The declared qualification
sum is 6.5 GiB, so the runner and helper fit under the same `<8 GiB`
production host budget while they run. Matching limits make a pass meaningful:
the test exercises the release image under the production service ceilings,
not a more generously provisioned rehearsal. This is still a qualification of
the release image and resources, not a change to SSE connection budgets or
production state.

#### One command: Compose on the production host

Use a release digest, never `:latest` or an attendee deployment URL. Run from a
checkout containing the release's compose file, with no production
`DATABASE_URL`/`VALKEY_URL` exported in the shell:

```sh
unset DATABASE_URL VALKEY_URL
export RELEASE_IMAGE=ghcr.io/example/hackos-api@sha256:<64-hex-release-digest>
export QUALIFICATION_ARTIFACT_DIR="$PWD/artifacts/event-day-qualification"
./deploy/qualification/run.sh
```

The entrypoint validates the rendered Compose JSON, tears down only the fixed
`hackos-event-day-qualification` project and its project-scoped qualification
volume, starts Postgres/Valkey, resets and prepares the synthetic fixture,
starts the exact-image API and dedicated worker, then runs the load runner from
inside the private network. An interrupted run has the same scoped cleanup
trap; rerun the command if cleanup was interrupted:

```sh
docker compose -p hackos-event-day-qualification \
  -f deploy/qualification/docker-compose.yml down --volumes --remove-orphans
```

Run the qualification stack from the production host shell, pointing at the
release checkout and `deploy/qualification/docker-compose.yml`; do not reuse
any production service, network, volume, database, Valkey, secret, or env file.
Set only `RELEASE_IMAGE` and `QUALIFICATION_ARTIFACT_DIR` in that qualification
environment, then run the same `deploy/qualification/run.sh`. The qualification
stack must be stopped and removed after the artifact is retrieved; it is not a
long-running production service.

The runner writes `result.json` even when a release budget fails and returns
nonzero in that case. Inspect the artifact before cleanup or retrieve it from
the host path after cleanup:

```sh
jq '.releaseImage, .fixture, .validation, .lanes' \
  artifacts/event-day-qualification/result.json
scp production-host:"$PWD/artifacts/event-day-qualification/result.json" .
```

The artifact contains counts, timings, lane budgets, admission/SSE metrics and
the release image; command-line database URLs are redacted. Do not copy fixture
IDs, cookies, attendee exports, or production metrics into the repository.

#### Qualification monitoring and gate

During the run, monitor only the qualification containers and database. The
API is reachable from the stack with `docker compose exec`, not from the host:

```sh
compose='docker compose -p hackos-event-day-qualification -f deploy/qualification/docker-compose.yml'
$compose ps
$compose exec api wget -qO- http://127.0.0.1:3000/metrics | \
  rg 'hackos_(http_requests|http_request_admission|sse_local_connections|sse_rejections|queue_participant_invalidations|browser_refetch)'
$compose exec postgres psql -U hackos_qualification -d hackos_event_day_qualification \
  -c "select count(*) as active, current_setting('max_connections') as max_connections, current_setting('shared_buffers') as shared_buffers from pg_stat_activity;"
$compose exec postgres psql -U hackos_qualification -d hackos_event_day_qualification \
  -c "select pid, now() - query_start as duration, state, query from pg_stat_activity where state <> 'idle' order by duration desc limit 5;"
docker stats --no-stream \
  hackos-event-day-qualification-api-1 hackos-event-day-qualification-worker-1 \
  hackos-event-day-qualification-postgres-1 hackos-event-day-qualification-valkey-1
```

The release gate is `validation.releaseBudgetPassed` and covers P0 operations,
P1 judging/review and P2 public TVs: p95 ≤ 2,000/2,000/3,000 ms and error rate
≤ 2%/2%/5%, respectively. Every release lane must have at least one sample;
an absent lane fails closed. P3 participant responses, including `429`
shedding, remain measured and explicitly non-gating. A nonzero runner status,
missing artifact, unhealthy container, unexpected restart, or qualification
database/Valkey state crossing the resource limits is a failed gate: stop,
retain the artifact/logs, fix the release or host, and rerun. Passing this gate
does not claim a production capacity limit.

### Optional external TLS/proxy canary

The internal qualification above is the only place to run the full mixed-write
scenario. This optional canary checks only the already-deployed TLS/proxy path:
never point `--mode prepare` at production, never send `x-test-user-id` to the
attendee API, and never amplify live accreditation, meal-scan, queue-transition
or review-write routes. Use dedicated synthetic accounts and read-only routes
only; run it outside attendee-facing hours with an operator watching the
dashboards.

After a production deploy, validate the live server with a bounded read/SSE
canary. Schedule it outside attendee-facing hours, announce the window, keep an
operator watching the dashboards, and use dedicated synthetic participant,
judge, and operator accounts with only the capabilities needed by the selected
read routes. Capture their session `Cookie` header in a secure shell variable;
do not paste cookies into the repository, terminal history, CI logs, or the
result document.

Set the deployment-specific values locally:

```sh
export API_BASE_URL=https://api.example.org
export ROOM_ID=<non-critical-room-id>
export ENTRY_ID=<non-critical-review-entry-id>
read -rs PARTICIPANT_COOKIE; export PARTICIPANT_COOKIE
read -rs JUDGE_COOKIE; export JUDGE_COOKIE
read -rs OPERATOR_COOKIE; export OPERATOR_COOKIE
```

1. **Record the idle baseline.** Confirm health, save the relevant Prometheus
   series, and note API/worker replica restarts, CPU/memory, Postgres active
   connections/lock waits, and Valkey/BullMQ depth before adding traffic.

   ```sh
   curl --fail --silent --show-error "$API_BASE_URL/healthz"
   curl --fail --silent --show-error "$API_BASE_URL/metrics" > /tmp/hackos-before.prom
   rg 'hackos_(http_requests|http_request_admission|sse_local_connections|sse_rejections|queue_participant_invalidations|browser_refetch)' /tmp/hackos-before.prom
   ```

2. **Open the expected public SSE canary.** Four connections represent the TV
   fleet without manufacturing hundreds of live participant streams. They
   should connect with HTTP `200`, remain open for 60 seconds, and disappear
   from `hackos_sse_local_connections{lane="P2",topic="public-tv"}` after
   they are stopped.

   ```sh
   sse_pids=()
   for _ in 1 2 3 4; do
     curl --fail --silent --show-error --no-buffer \
       "$API_BASE_URL/api/tv/stream" >/dev/null &
     sse_pids+=("$!")
   done
   sleep 5
   curl --fail --silent --show-error "$API_BASE_URL/metrics" | \
     rg 'hackos_sse_local_connections\{lane="P2",topic="public-tv"\} 4'
   sleep 55
   kill "${sse_pids[@]}" 2>/dev/null || true
   wait "${sse_pids[@]}" 2>/dev/null || true
   ```

3. **Ramp read-only traffic, one step at a time.** Install nothing on the
   production host; run the client from a separate machine with stable network
   latency. Start with 30-second steps and allow metrics to return to baseline
   between them. `autocannon` treats the supplied cookie as sensitive, so run
   these commands only in an ephemeral shell with history disabled.

   ```sh
   # P2 public projection: 4 -> 10 concurrent readers
   pnpm dlx autocannon -c 4 -d 30 "$API_BASE_URL/api/tv/rooms"
   pnpm dlx autocannon -c 10 -d 30 "$API_BASE_URL/api/tv/rooms"

   # P3 participant best effort: 10 -> 25 -> 50 concurrent readers
   pnpm dlx autocannon -H "Cookie=$PARTICIPANT_COOKIE" -c 10 -d 30 "$API_BASE_URL/api/queue/me"
   pnpm dlx autocannon -H "Cookie=$PARTICIPANT_COOKIE" -c 25 -d 30 "$API_BASE_URL/api/queue/me"
   pnpm dlx autocannon -H "Cookie=$PARTICIPANT_COOKIE" -c 50 -d 30 "$API_BASE_URL/api/queue/me"
   ```

4. **Verify reserved lanes while the final P3 step runs.** From separate
   terminals, keep a small P0/P1 read canary active. These are read-only views;
   do not substitute `call-next`, scan, review `PATCH`, or other mutations on
   the live event.

   ```sh
   # P0 operational room projection
   pnpm dlx autocannon -H "Cookie=$OPERATOR_COOKIE" -c 5 -d 30 \
     "$API_BASE_URL/api/queue/rooms/$ROOM_ID/view"

   # P1 collaborative review projection
   pnpm dlx autocannon -H "Cookie=$JUDGE_COOKIE" -c 5 -d 30 \
     "$API_BASE_URL/api/queue/entries/$ENTRY_ID/review"
   ```

5. **Capture the post-run evidence.** Save metrics and the three client
   summaries with the deploy SHA, replica counts, timestamp, and client region.
   Session cookies and identifiers do not belong in the report.

   ```sh
   curl --fail --silent --show-error "$API_BASE_URL/metrics" > /tmp/hackos-after.prom
   rg 'hackos_(http_requests|http_request_admission|sse_local_connections|sse_rejections|queue_participant_invalidations|browser_refetch)' /tmp/hackos-after.prom
   ```

Stop the ramp immediately if `/healthz` fails, a replica restarts, Postgres
active connections exceed 80% of `max_connections`, lock waits keep rising,
P0/P1 errors exceed 2%, or P0/P1 p95 exceeds 2 seconds for two consecutive
30-second steps. Also stop if the P0/P1 admission queue does not drain within
60 seconds after a step or SSE rejections/disconnects rise unexpectedly. P3
`429` responses are allowed, but they are evidence that the next ramp step is
not useful. Reduce concurrency, preserve the before/after evidence, and follow
the deployment rollback procedure before retrying.

The canary establishes that the deployed routing, authentication, admission,
SSE, and observability paths work under bounded pressure. It does not replace
the pre-deploy 600-client mixed-write test, and it must not be used to claim a
new production capacity limit.

### Budgets and measured local capacity

These are the release gates encoded in the harness; P3 is measured but may
degrade under admission pressure:

| Lane | p95 latency budget | Error budget | Measured p95 | Measured errors | Result |
|---|---:|---:|---:|---:|---|
| P0 operations | ≤ 2,000 ms | ≤ 2% | 804 ms | 0% | pass |
| P1 judging/review | ≤ 2,000 ms | ≤ 2% | 860 ms | 0% | pass |
| P2 public TVs | ≤ 3,000 ms | ≤ 5% | 205 ms | 0% | pass |
| P3 participants | measured, not release-gating | best effort | 941 ms | 35.4% shed | allowed degradation |

The clean local run lasted 10 seconds (12.5 seconds including setup/drain),
processed 2,121 HTTP/SSE samples, and sustained 58.0 P0 requests/s, 9.6 P1
requests/s, 6.1 P2 requests/s, and 96.2 P3 requests/s over the measured
window. Admission wait p95 estimates were 0.5 s (P0), 1 s (P1), 1 ms (P2),
and 1 s (P3); the largest observed waiting queues were P0 427, P1 100, P2
0, P3 160. P3 shedding is therefore visible rather than silently consuming
reserved operational capacity.

The run opened 628 physical SSE connections: 600 participant personal streams,
20 judging-review streams, four operator queue streams, and four public TV
streams. The participant invalidation counters were queued 3, coalesced 117,
dropped 0, degraded 0; the browser observation recorded one bounded report for
600 refetches. These counts verify the intended queue transition coalescing and
SSE/refetch measurement path, not a production capacity guarantee.

The checked-in artifact above is historical: it used the older fixture and
`DB_POOL_MAX=20` in test mode. It remains a measured local baseline, not the
event-day qualification result. New runs use `DB_POOL_MAX=24`, the event-shape
fixture above, and the deployment tables' memory limits; they still do not
change #540-owned statement/idle timeouts, SSE backpressure, or connection
budgets. The result is single-process, local Docker infrastructure, so repeat
it on event-like hardware before setting a production capacity claim.

## Monitoring queries

Run these against `postgres` during the event (`docker exec -it <postgres
container> psql -U $POSTGRES_USER -d $POSTGRES_DB`):

```sql
-- Active connections vs. the ceiling
select count(*) as active,
       current_setting('max_connections') as max_connections,
       current_setting('shared_buffers') as shared_buffers
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
covers moving it to a second host behind a private network, while keeping the
canonical runtime isolated from that optional host.
