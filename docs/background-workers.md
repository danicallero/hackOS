# Background processing & the worker subsystem

> **Read this first.** The single most important thing to understand is that
> hackOS does **not** push per-entity jobs onto a queue and process them with
> BullMQ retries/DLQ. It runs a small set of **repeatable "tick" workers** that
> periodically **drain database-backed queues** (`notification_outbox`, due
> confirmations, scheduled reveals, room queues). Durability, retry, backoff and
> the dead-letter state all live in **Postgres rows**, not in BullMQ. BullMQ is
> just the cron-like heartbeat. Everything else the original brief imagined as
> "worker jobs" (batch decisions and DNI sync) runs **synchronously inside the
> API request**. Account deletion/anonymization starts synchronously, then uses
> its retry/finalization path described in the [event map](#event-mapping).

## Scaffolding

`apps/api/src/lib/queues.ts` is the whole framework:

- `registerWorker(name, processor)` — a module declares its processor at import
  time. `getQueue(name)` lazily creates the BullMQ `Queue`.
- `startWorkers()` — instantiates one BullMQ `Worker` per registered processor.
- Connection: dedicated `ioredis` clients against `VALKEY_URL` with
  `maxRetriesPerRequest: null`, as BullMQ requires. These options are isolated
  in `queues.ts`; API cache, health, and SSE clients use a finite fail-fast
  policy and never share the BullMQ connections (#535).

**Where workers run** (`config.ts:workersInline`):
- **dev / test** (`NODE_ENV !== production`, or `WORKERS_INLINE=1`): inline in
  the API process.
- **production**: a dedicated entrypoint `apps/api/src/worker.ts`
  (`node dist/src/worker.js`) in its own container — no HTTP listener — so heavy
  jobs never degrade request latency. Importing `modules/index.js` has the side
  effect of registering every processor; then `startWorkers()`.

## The repeatable workers (queues)

Every worker is a repeatable job scheduled with
`{ repeat: { every: N }, jobId: <queue>, removeOnComplete: true, removeOnFail: true }`.
Using a fixed `jobId` means BullMQ keeps **exactly one** repeatable instance per
queue no matter how many times scheduling runs (idempotent scheduling).

| Queue (`jobId`) | File | Tick | What it drains |
| --- | --- | --- | --- |
| `notifications-outbox` | `notifications/dispatcher.ts` | **5 s** | `notification_outbox` rows that are `queued AND next_attempt_at <= now()` → renders + sends via the channel adapter |
| `announcements-publisher` | `notifications/announcements-publisher.ts` | **15 s** | announcements whose `publish_at` has passed → reveals their configured screen placement and, when selected, fans out inbox/email/push through each recipient's preferences exactly once |
| `spot-confirmation expirer` | `applications/expirer.ts` | **60 s** | accepted responses whose confirmation window elapsed → `expired` (`expireDueConfirmations`), then scoped wallet tokens dead for over a day (`purgeExpiredWalletAccessTokens`, issue #369) |
| `queue-pump` | `queue/pump.ts` | repeatable | for each active room, tops up the live judging queue (`callNextForRoom`) |
| `queue-participant-invalidations` | `queue/notify.ts` | event-driven, 250 ms debounce | coalesces participant H38 read-model refresh fan-out by queue group after queue transitions commit; a merged group reaches members queued on any member challenge; called/pre-call events bypass it and remain immediate; Prometheus records `queued`, `coalesced`, `dropped` (broker unavailable) and `degraded` (partial fan-out) outcomes |
| `tv-scheduler` | `queue/tv-scheduler.ts` | **5 s** | resolves what the venue screens should show (operator override → covering `tv_slots` window → default `rooms`), drops an override whose `expiresAt` passed, and broadcasts `tv.mode.changed` **only when the resolved state changed** — so a slot boundary reaches the fleet unattended without waking every screen every tick (H42). The public TV SSE endpoint receives only the dedicated payload-free `public-tv` invalidation mirror and refetches its sanitized projection; the operational TV event remains off the public stream. |
| `presence-event-end-closer` | `logistics/presence-closer.ts` | **60 s** | once `event_config.event_ends_at` passes, force-closes every still-open door session with an audited `out` at that instant (`scanned_by NULL` = system actor, migration 0708), and finalizes pending account removals after that valid event-end exit or after the latest accrued H24 certainty window expires. An `out` outside the certainty window credits no hours; it restores the in/out invariant while the expiry path preserves only already-guaranteed minutes. |

(The table lists the workers relevant to the flows documented here; other
modules register more tick workers the same way — grep `registerWorker(` for
the full set.)

Each tick function is **exported** (e.g. `dispatchOutboxOnce`, `pumpTick`,
`expireDueConfirmations`) so tests invoke it directly instead of waiting on
BullMQ timing.

## Job flow — email dispatch (an async path)

This is how M5's email-verification and all decision/invite emails actually get
delivered.

```
API request (sync)                          worker tick (async, every 5s)
────────────────                            ──────────────────────────────
enqueueAuthEmail()/notify()                 dispatchOutboxOnce():
  INSERT notification_outbox                  SELECT ... WHERE status='queued'
    (status='queued',                           AND next_attempt_at<=now()
     next_attempt_at=now(),                      FOR UPDATE SKIP LOCKED
     payload={template,vars,                   for each row:
             recipient?,language?})             render + send via channel adapter
  COMMIT  ── returns to caller                   success -> status='sent'
                                                  failure -> retry/park (below)
```

`payload.recipient` overrides `users.email` in the email adapter
(`channels/email.ts`) — this is the mechanism M5's secondary-email fix relies on.

## Queue structure, retries, concurrency & the dead-letter model

The **`notification_outbox` table is the real queue.** Relevant columns:
`status ('queued'|'sent'|'failed')`, `attempts`, `last_error`,
`next_attempt_at`, `sent_at`. Partial index `notification_outbox_pending` on
`next_attempt_at WHERE status='queued'` keeps the claim query cheap.

**Retry / backoff** (`dispatcher.ts`):
- `MAX_ATTEMPTS = 8`, `BASE_DELAY_MS = 30 s`, `MAX_DELAY_MS = 30 min`.
- `backoffDelayMs(attempts) = min(BASE_DELAY_MS * 2^(attempts-1), MAX_DELAY_MS)`
  — exponential backoff, capped at 30 min.
- On failure with `attempts < MAX_ATTEMPTS`: `attempts++`, `last_error` set,
  `next_attempt_at` pushed out — **status stays `queued`**, so the next tick
  retries it after the backoff.

**Dead-letter (DLQ) strategy.** There is no separate BullMQ DLQ. A message is
**parked** by setting `status='failed'` when either:
- `attempts` reaches `MAX_ATTEMPTS`, or
- a `PermanentDispatchError` is thrown (e.g. Discord "channel not configured") —
  fail fast, don't waste 8 attempts.

Parked rows are **never deleted**; `last_error` is retained so an admin/audit
surface can inspect and (if desired) requeue them. That `status='failed'` set is
the dead-letter queue.

**Concurrency & safety.**
- One BullMQ `Worker` per queue (default concurrency). The fixed `jobId` on the
  repeatable job prevents duplicate schedulers.
- The claim query uses **`FOR UPDATE SKIP LOCKED`**, so even if multiple API/
  worker instances tick at once, a row locked by one drain is invisible to the
  others — no double-send, safe horizontal scaling.
- Each tick claims up to `NOTIFICATION_OUTBOX_BATCH_SIZE` rows (default `100`,
  see `docs/env-vars.md`), but claims, dispatches, and commits **one row per
  transaction** (`claimAndDispatchOne` in `dispatcher.ts`) rather than
  batching the whole tick into one transaction. That bounds the
  duplicate-send window on a mid-tick crash to at most the single row that
  was in flight, independent of batch size — see
  `docs/big-event-readiness.md` for why that makes 100 safe as a permanent
  default.
- State-machine ticks (expirer, pump) run their mutations inside
  `withTransaction` + `SELECT … FOR UPDATE`, honouring the "exactly one winner
  per transition" invariant (`plan/07`).

## Event mapping — synchronous vs. background

The brief asked which module events are background jobs vs. handled by API
controllers. This is the honest map:

| Module event | Where it runs | Notes |
| --- | --- | --- |
| **M2 batch decisions** (`batchDecide`, `batchReAccept`, `batchRevokeSpots`, …) | **Synchronous** in the request (`runBatch`) | Per-row failures collected as `skipped[]`; not queued |
| **M1 DNI sync** (`extractDni` → `users.dni`) | **Synchronous** in the submit transaction | Same tx as the response write |
| **M1 name-lock check** | **Synchronous** in `PATCH /api/me` | A read-guard, no job |
| **M5 primary-email change** | **Synchronous** in the request | One audited transaction |
| **H54 account anonymize / delete** | **Two-phase request + retry worker** | Commits `removal_pending` and revokes access first; provider/object cleanup is retried, then the final user deletion or anonymous-subject migration is one transaction. Pending-exit rows are finalized by a valid current exit, the event-end automatic exit, or expired H24 certainty state. Failed jobs expire from the queue after 24 hours and remain operator-retriable from the pending row. |
| **M5 secondary-email verification email** | **Async** | Enqueued to `notification_outbox`; delivered by the `notifications-outbox` dispatcher |
| **Decision / invite / reset emails** | **Async** | Same outbox → dispatcher path |
| **Spot-confirmation expiry** (H15) | **Async** | `spot-confirmation expirer` tick every 60 s |
| **Scheduled announcement reveals** | **Async** | `announcements-publisher` tick every 15 s |
| **Judging queue top-up** (H29+) | **Async** | `queue-pump` tick |
| **Participant queue read-model invalidation** (H38) | **Async** | one delayed BullMQ job per queue group coalesces transition bursts; its worker fans out personal refresh signals to members queued on any challenge in that group. A broker failure is best-effort `dropped`, while partial SSE publication is `degraded`; called/pre-call notifications stay immediate. |
| **TV slot boundaries / override expiry** (H42) | **Async** | `tv-scheduler` tick every 5 s |

**Takeaway for future work:** if you want something processed in the background,
write it to a durable table with a `status` + `next_attempt_at`, and either
extend an existing tick or add a new `registerWorker`. Do not reach for BullMQ
per-job retries/DLQ — the codebase's contract is DB-owned durability drained by
idempotent ticks.

## Queue and public-screen streams

`GET /api/queue/stream` is an authenticated operational channel: only global
`queue:operate`, `queue:admin`, or `judge:panel` holders can subscribe because
its events carry room-control and team details. `GET /api/events/stream` is
authenticated only when a domain topic is supplied (`applications`, `projects`,
`identity`, `sponsors`, `logistics`, or `audit`); it carries payload-free
`domain.changed` signals and never acts as a global refresh channel. Public
`/api/tv/stream` subscribes only to `public-tv` (mirrors `queue` and `tv`) and
`/api/content/stream` only to `public-content` (mirrors `content` and explicit
public sponsor/challenge changes). Both mirrors use an empty `data.changed`
envelope, never the source payload, and neither sees private roster, identity,
logistics or export writes.
A public screen refetches `/api/tv/mode`, `/api/tv/rooms`, or its public content
projection after its relevant invalidation; it never receives operational queue,
account, project-link, or content-management payloads over SSE.
