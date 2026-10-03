# Realtime transport (#892)

Web and native clients register logical readers with one transport owner per
browser tab or native instance. There is no cross-tab sharing. Public TV keeps
its single payload-free `/api/tv/stream`, including content invalidations.
Collaborative review remains a logical SSE scope; judging WebSockets and
bidirectional presence/lease coordination are a separate migration.

## Authenticated contract

`GET /api/realtime/stream?scopes=personal,queue,domain:projects` accepts up to
16 comma-separated scopes, within a 2,048-character request URL. All scopes
must authorize before the response opens; malformed scopes return 400,
unauthenticated calls 401, and missing capability/relationship access 403
(with the existing contextual not-found/fixture errors preserved).

| Scope | Broker topic / guard |
| --- | --- |
| `personal` | Server-derived `user:<current id>`; active authenticated account. |
| `queue` | Queue operate/admin or global judge panel; server selects real/fixture topic. |
| `logistics` | Accreditation/presence/activity scan, logistics stats or schedule manage; real/fixture topic. |
| `exports` | `exports:run`. |
| `domain:applications`, `domain:projects`, `domain:identity`, `domain:sponsors` | Existing authenticated domain refresh access. |
| `domain:audit`, `domain:tv` | Audit read / TV control respectively. |
| `domain:logistics` | Existing domain guard, which also accepts intolerance management; real/fixture topic. |
| `review:<positive entry id>` | Existing entry judge/global panel guard, including fixture isolation; PostgreSQL integer bound. |
| `public-tv`, `public-content` | Authenticated attachment of the existing empty public invalidation projections. |

No arbitrary Valkey topic, another user's personal channel, or explicit fixture
topic is accepted. Shared event names and scope/limit constants live in
`packages/shared/src/events.ts`. Each multiplexed `data:` envelope includes
`topic`, the requested **logical scope**, plus `type`, `id`, `at`, and `data`.
It uses the default SSE message frame, so all events advance the scope's gap
cursor even when no consumer wants that event type. Legacy endpoints retain
their named events and numeric SSE ids.

Sequence ids belong to the underlying topic, never the physical connection.
Clients track each logical scope independently. There is **no event replay**
and no multiplexed `Last-Event-ID` cursor: reconnect/foreground recovery
refetches the active scopes, and a gap refetches only that scope. The first
event after a recovery establishes a new baseline. A gap hint replaces that
event's refresh hint to avoid two recovery reads.

## Lifecycle and revocation

`packages/shared/src/realtime-client.ts` owns bounded fetch parsing and retry;
web `sse-broker.ts` and native `server-events.ts` supply session and platform
lifecycle. Components reference-count scopes, with a 100 ms debounce on changes
to the union. Any changed union aborts the old reader before opening its
replacement. Recovery resyncs the new union because events during that brief
gap are lossy. Removing the final consumer cancels the reader and retries.
Event type filters and recovery callbacks both retain scope isolation.

Web's session provider establishes the identity used by **all** readers;
component identity keys never open separate transports. Native's profile
provider establishes identity before reader effects mount. Sign-out, account
changes and native API-origin changes drop transport, topic cursors and old
listeners. Generation checks fence delayed fetch/read completions and retries.
Native backgrounding cancels the reader; foreground opens one replacement and
resyncs its scopes once. The account profile's existing foreground read owns
session recovery; the personal stream does not issue a duplicate foreground
profile read. Cache-backed SSE models disable their separate long-background
read and poll only while their scope is disconnected.

The server rechecks the session row, active account, current capabilities,
relationships, entry access and fixture mapping **before each delivery batch**
and at the 25-second heartbeat. Unauthorized payloads fail closed; an idle
revoked session is closed within one heartbeat plus database-check latency.
Authorization failure closes the entire connection, including subscriptions
that remain valid. Reopening reauthorizes the union; 401/403 cause scoped
session/read-model recovery and stop transport retries until identity or the
subscription union changes. Capability-driven navigation then removes scopes
the account no longer owns. Database failures also close the stream rather than
allowing unchecked delivery.

Role and sponsor services retain explicit affected-user snapshots, including
removed members. `lib/session-invalidation.ts` snapshots before/after successful
profile, project membership/import, application response/form, statistics ACL,
and event-policy mutations, then emits empty personal `user.session.changed`
notifications to their affected accounts. Deleted memberships remain in the
before snapshot. Failed or idempotently replayed mutations emit nothing from
this hook. Personal queue/wallet invalidations also refresh session navigation
facts. These are freshness signals after commit, not part of the durable write;
publication/snapshot failures are logged and lifecycle recovery remains the
fallback.

## Bounds and metrics

Server pending authorization frames and client parser buffers are capped at
64 KiB. Backpressured writes preserve the existing drain timeout and slow-client
disconnect. Global/per-client admission counts physical connections once;
per-broker-topic limits still restrict topic attachments. Physical gauges use
the highest-priority attached lane and `topic="multiplexed"`. Logical gauges
count each scope attachment separately, including aliases of one broker topic.

- `hackos_sse_local_connections`: physical connections.
- `hackos_sse_local_subscriptions`: logical attachments by bounded topic family.
- `hackos_sse_writes_total{kind="connection|heartbeat|event"}` and
  `hackos_sse_write_bytes_total`: actual physical writes/bytes.
- `hackos_sse_reauthorizations_total{outcome="allowed|denied"}`: access checks.
- Existing rejection/disconnect counters include authorization and pending-buffer
  disconnects. Existing browser read-model telemetry keeps its logical dimensions;
  local transport accounting uses one multiplexed physical source.

Only successful `text/event-stream` responses establish a connection. Wrong
content types are canceled and retry with backoff without triggering recovery
reads. Retry uses exponential 1–30 second backoff plus jitter, honors `Retry-After` as
a minimum (including values over 60 seconds), and prevents stale reader loops
from scheduling retries. Logical subscription changes coalesce independently
of that failure backoff. Web recovery reads retain exact-resource invalidation,
deduplication, debounce and disconnected-only polling.

## Qualification and rollout

Run without concurrent API tests or other publishers on the local Valkey
instance: Redis/Valkey pub/sub channels cross logical database indexes.
From `apps/api`, run `pnpm exec tsx scripts/realtime-load.ts`. It creates,
migrates and removes a uniquely named local qualification database, and starts
separate API processes for legacy/multiplexed measurements. Optional
`REALTIME_LOAD_CLIENTS` (1–600), `REALTIME_LOAD_DURATION_MS` (10–120 seconds),
`REALTIME_LOAD_OUTPUT`, and `REALTIME_LOAD_DATABASE_URL` configure only this
local harness. It never targets a deployed API or resets an existing database.
The 600-client default runs 30 seconds per mode, carries three logical scopes,
measures one identity/project burst and foreground recovery of 10% of instances.

Results are stored in [realtime-load-results.json](./realtime-load-results.json).
Socket/heartbeat savings do not imply proportional database or total CPU savings:
event delivery and authoritative refetch demand remain, while multiplexed
reauthorization adds database work. Read errors are reported explicitly; this
harness is transport qualification, not a full production-capacity sign-off.
The common-topic limit is raised to 2,000 for this run because the default 500
would reject 600 consumers of the same domain even after multiplexing.

The standalone local 600-client run recorded:

| Measurement | Legacy | Multiplexed |
| --- | ---: | ---: |
| Peak physical sockets | 1,800 | 600 |
| Logical attachments | 1,800 | 1,800 |
| Heartbeat writes over ~30 seconds | 1,800 | 600 |
| Event writes | 1,200 | 1,200 |
| Controlled transport reopens | 180 | 60 |
| API RSS peak (MiB) | 310.1 | 287.7 |
| API authoritative refetch attempts | 1,320 | 1,320 |
| Refetch successes | 362 | 330 |
| Refetch HTTP 429 / transport errors | 907 / 51 | 698 / 292 |
| Delivery/heartbeat authorization checks | 0 | 1,800 |

The synchronized read burst overloaded local finite-request admission in both
modes. This demonstrates the socket/heartbeat reduction, **not** readiness for a
600-client refetch burst. Refetch demand is unchanged; admission/refetch recovery
needs separate event-day qualification. RSS is a noisy process peak across two
runs, not a proportional memory/CPU saving claim.

Keep all legacy endpoints for installed mobile compatibility. Deploy API support
before new clients, monitor physical/logical gauges, access-check load, refetch
errors and reconnect rates, and retire legacy endpoints only after supported
installed versions permit it.
