# Background processing & the worker subsystem

> **Read this first.** The single most important thing to understand is that
> hackOS does **not** push per-entity jobs onto a queue and process them with
> BullMQ retries/DLQ. It runs a small set of **repeatable "tick" workers** that
> periodically **drain database-backed queues** (`notification_outbox`, due
> confirmations, scheduled reveals, room queues). Durability, retry, backoff and
> the dead-letter state all live in **Postgres rows**, not in BullMQ. BullMQ is
> just the cron-like heartbeat. Everything else the original brief imagined as
> "worker jobs" (batch decisions, DNI sync, account deletion) actually runs
> **synchronously inside the API request** — see the [event map](#event-mapping).

## Scaffolding

`apps/api/src/lib/queues.ts` is the whole framework:

- `registerWorker(name, processor)` — a module declares its processor at import
  time. `getQueue(name)` lazily creates the BullMQ `Queue`.
- `startWorkers()` — instantiates one BullMQ `Worker` per registered processor.
- Connection: `ioredis` against `VALKEY_URL` with `maxRetriesPerRequest: null`.

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
| `announcements-publisher` | `notifications/announcements-publisher.ts` | **15 s** | announcements whose `publish_at` has passed → reveals them |
| `spot-confirmation expirer` | `applications/expirer.ts` | **60 s** | accepted responses whose confirmation window elapsed → `expired` (`expireDueConfirmations`) |
| `queue-pump` | `queue/pump.ts` | repeatable | for each active room, tops up the live judging queue (`callNextForRoom`) |
| `presence-event-end-closer` | `logistics/presence-closer.ts` | **60 s** | once `event_config.event_ends_at` passes, force-closes every still-open door session with an audited `out` at that instant (`scanned_by NULL` = system actor, migration 0708). H24 product override of the original "the system never closes a session itself" rule; an `out` outside the certainty window credits no hours, so it only restores the in/out invariant. |

(The table lists the workers relevant to the flows documented here; other
modules register more tick workers the same way — grep `registerWorker(` for
the full set.)

Each tick function is **exported** (e.g. `dispatchOutboxOnce`, `pumpTick`,
`expireDueConfirmations`) so tests invoke it directly instead of waiting on
BullMQ timing.

## Job flow — email dispatch (the one truly async path)

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
| **M5 primary-email change / anonymize / delete** | **Synchronous** in the request | Single transaction; no cascade jobs |
| **M5 secondary-email verification email** | **Async** | Enqueued to `notification_outbox`; delivered by the `notifications-outbox` dispatcher |
| **Decision / invite / reset emails** | **Async** | Same outbox → dispatcher path |
| **Spot-confirmation expiry** (H15) | **Async** | `spot-confirmation expirer` tick every 60 s |
| **Scheduled announcement reveals** | **Async** | `announcements-publisher` tick every 15 s |
| **Judging queue top-up** (H29+) | **Async** | `queue-pump` tick |

**Takeaway for future work:** if you want something processed in the background,
write it to a durable table with a `status` + `next_attempt_at`, and either
extend an existing tick or add a new `registerWorker`. Do not reach for BullMQ
per-job retries/DLQ — the codebase's contract is DB-owned durability drained by
idempotent ticks.
