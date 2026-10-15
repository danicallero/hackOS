/**
 * Replay contract between the server's `idempotency_keys` retention and the
 * mobile offline scanner queue (#994, H54 data minimisation). A queued scan
 * replays with its scan id as Idempotency-Key, so it must stop replaying
 * before the server can purge that key; otherwise an already-applied scan
 * would execute a second time.
 */

/** Completed `idempotency_keys` rows are purged after this many days. */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/**
 * Oldest offline scan the mobile queue still replays, measured from when the
 * device queued it. One day below retention absorbs device-clock drift.
 */
export const SCANNER_REPLAY_MAX_AGE_DAYS = IDEMPOTENCY_RETENTION_DAYS - 1;

/** Stored failure code for a queued scan older than the replay window. */
export const SCAN_REPLAY_EXPIRED = "scan_replay_expired";
