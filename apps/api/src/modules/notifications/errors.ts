/**
 * Internal-only error used by channel adapters (not an AppError — never
 * reaches an HTTP response). Thrown when a failure is known to be permanent
 * so the dispatcher parks the outbox row as `failed` immediately instead of
 * burning through the retry ladder for a condition that will never resolve
 * itself.
 */
export class PermanentDispatchError extends Error {}

/**
 * Thrown when an outbox row no longer matches the current state of the thing
 * it describes (H51/H52) — e.g. a "you were called to room X" push whose
 * queue entry has since moved on (requeued, re-called elsewhere, completed)
 * because the send was delayed by retry backoff. The dispatcher parks these
 * as `status = 'superseded'` instead of sending or retrying: sending it now
 * would be a stale/duplicate-feeling notification for a turn that's over.
 */
export class SupersededDispatchError extends Error {}
