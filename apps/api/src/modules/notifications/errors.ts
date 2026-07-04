/**
 * Internal-only error used by channel adapters (not an AppError — never
 * reaches an HTTP response). Thrown when a failure is known to be permanent
 * (e.g. discord's "channel not configured" no-op) so the dispatcher parks the
 * outbox row as `failed` immediately instead of burning through the retry
 * ladder for a condition that will never resolve itself.
 */
export class PermanentDispatchError extends Error {}
