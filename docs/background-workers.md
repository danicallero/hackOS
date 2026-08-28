# Background processing & the worker subsystem

The worker subsystem has two execution patterns. Repeatable BullMQ ticks drain
durable Postgres tables (the notification outbox, due confirmations, scheduled
reveals, and room queues). Event-driven BullMQ jobs carry an explicit payload
for work that starts in a request, such as account-removal retries, data-subject
requests, meal-scan batches, wallet sync, schedule reminders, and participant
queue invalidations. The API still handles batch decisions and DNI sync
synchronously. Each path owns its idempotency and retry policy; BullMQ is the
dispatcher, not the durable source of truth for database state.

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

## Repeatable workers (queues)

Every worker is a repeatable job scheduled with
`{ repeat: { every: N }, jobId: <queue>, removeOnComplete: true, removeOnFail: true }`.
Using a fixed `jobId` means BullMQ keeps **exactly one** repeatable instance per
queue no matter how many times scheduling runs (idempotent scheduling).

| Queue (`jobId`) | File | Tick | What it drains |
| --- | --- | --- | --- |
| `notifications-outbox` | `notifications/dispatcher.ts` | **5 s** | `notification_outbox` rows that are `queued AND next_attempt_at <= now()` → renders + sends via the channel adapter |
| `announcements-publisher` | `notifications/announcements-publisher.ts` | **15 s** | announcements whose `publish_at` has passed → reveals their configured screen placement and, when selected, fans out inbox/email/push through each recipient's preferences exactly once |
| `applications-expirer` | `applications/expirer.ts` | **60 s** | accepted responses whose confirmation window elapsed → `expired` (`expireDueConfirmations`), then scoped wallet tokens dead for over a day (`purgeExpiredWalletAccessTokens`, issue #369) |
| `queue-pump` | `queue/pump.ts` | repeatable | discovers each active room, then tops up its live judging queue (`topUpRoom` → one transactional `callNextForRoom` per slot) and emits pre-call warnings through a separately locked group/repo claim |
| `tv-scheduler` | `queue/tv-scheduler.ts` | **5 s** | resolves what the venue screens should show (operator override → covering `tv_slots` window → default `rooms`), drops an override whose `expiresAt` passed, and broadcasts `tv.mode.changed` **only when the resolved state changed** — so a slot boundary reaches the fleet unattended without waking every screen every tick (H42). The public TV SSE endpoint receives only the dedicated payload-free `public-tv` invalidation mirror and refetches its sanitized projection; the operational TV event remains off the public stream. |
| `presence-event-end-closer` | `logistics/presence-closer.ts` | **60 s** | once `event_config.event_ends_at` passes, force-closes every still-open door session with an audited `out` at that instant (`scanned_by NULL` = system actor, migration 0710), and finalizes pending account removals after that valid event-end exit or after the latest accrued H24 certainty window expires. An `out` outside the certainty window credits no hours; it restores the in/out invariant while the expiry path preserves only already-guaranteed minutes. |
| `schedule-reminders` | `notifications/schedule-reminders.ts` | **15 s** | finds opted-in recipients for activities starting within the reminder lead time and records `reminded_at` as it sends notifications |
| `scheduled-visibility-publisher` | `challenges/visibility-publisher.ts` | **15 s** | reveals challenge visibility whose scheduled time has passed |
| `schedule-visibility-publisher` | `logistics/schedule-publisher.ts` | **15 s** | reveals audience-tagged schedule items whose publish time has passed |

Repeatable jobs use a fixed `jobId`, so scheduling the same tick more than once
does not create duplicate schedulers.

## Event-driven workers (payload jobs)

These queues are added in response to a request or committed domain event. They
are not periodic table drains, and most use BullMQ attempts/backoff in addition
to the durable row or source record they process.

| Queue | Producer | Work |
| --- | --- | --- |
| `account-removal-retries` | `identity/removal.ts` | retries provider/storage cleanup and H54 finalization; the pending account row remains the operator recovery record |
| `data-subject-requests` | `exports/requests.service.ts` | builds an export or executes an administrator-requested removal for one DSR row |
| `logistics.meal-scans` | `logistics/offline-meals.ts` | processes one persisted offline meal-scan batch, keyed by `(device_id, client_scan_id)` |
| `logistics.wallet-sync` | `logistics/wallet-sync.ts` | sends Apple push updates or expires Google Wallet objects after pass changes |
| `queue-participant-invalidations` | `queue/notify.ts` | debounced H38 read-model refresh fan-out by current queue group; topology changes carry old/new memberships and called/pre-call notifications remain immediate |

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
- The queue pump does not wrap a whole tick in one transaction. `pumpTick`
  discovers active rooms, `topUpRoom` checks the live window, and each
  `callNextForRoom` owns its own `withTransaction` and row/advisory locks; a
  later slot can therefore refill independently if an earlier call loses a
  race. Pre-call discovery is also deliberately outside a transaction, while
  `claimPreCall` reacquires the queue-group lock, locks its entries, validates
  the fixture marker, and atomically claims one logical repo cycle before
  notifying. These are the transaction boundaries that preserve the
  "exactly one winner per transition" invariant (`plan/07`).

## Event mapping — synchronous vs. background

The table below maps module events to their execution path:

| Module event | Where it runs | Notes |
| --- | --- | --- |
| **M2 batch decisions** (`batchDecide`, `batchReAccept`, `batchRevokeSpots`, …) | **Synchronous** in the request (`runBatch`) | Per-row failures collected as `skipped[]`; not queued |
| **M1 DNI sync** (`extractDni` → `users.dni`) | **Synchronous** in the submit transaction | Same tx as the response write |
| **M1 name-lock check** | **Synchronous** in `PATCH /api/me` | A read-guard, no job |
| **M5 primary-email change** | **Synchronous** in the request | One audited transaction |
| **H54 account anonymize / delete** | **Two-phase request + retry worker** | Commits `removal_pending` and revokes access first; provider/object cleanup is retried, then the final user deletion or anonymous-subject migration is one transaction. Pending-exit rows are finalized by a valid current exit, the event-end automatic exit, or expired H24 certainty state. Failed jobs expire from the queue after 24 hours and remain operator-retriable from the pending row. |
| **M5 secondary-email verification email** | **Async** | Enqueued to `notification_outbox`; delivered by the `notifications-outbox` dispatcher |
| **Decision / invite / reset emails** | **Async** | Same outbox → dispatcher path |
| **Spot-confirmation expiry** (H15) | **Async** | `applications-expirer` tick every 60 s |
| **Scheduled announcement reveals** | **Async** | `announcements-publisher` tick every 15 s |
| **Judging queue top-up** (H29+) | **Async** | `queue-pump` tick |
| **Participant queue read-model invalidation** (H38) | **Async** | one delayed BullMQ job per current queue group coalesces transition bursts; topology writes carry old/new group snapshots and the worker re-resolves current membership, so stale/deleted group ids do not discard a valid refresh. It fans out personal signals to members queued on any challenge in that group. A broker failure is best-effort `dropped`, while partial SSE publication is `degraded`; called/pre-call notifications stay immediate. |
| **TV slot boundaries / override expiry** (H42) | **Async** | `tv-scheduler` tick every 5 s |

**Takeaway for future work:** choose the worker pattern that matches the
durability boundary. Use a durable table with `status`/`next_attempt_at` for a
periodic drain; use an event-driven queue when a committed request needs an
explicit payload or external side effect. In both cases keep the database row
authoritative, make processing idempotent, and document the retry/dead-letter
policy beside the processor.

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
