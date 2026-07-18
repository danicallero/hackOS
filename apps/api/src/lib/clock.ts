/**
 * Grace window for "must be in the past" scan-timestamp checks. Client and
 * server clocks are never perfectly in sync (phone NTP drift, container
 * clock skew); comparing a client-supplied timestamp against a bare
 * `Date.now()` with zero tolerance rejects legitimate scans whenever the
 * client is even a few seconds ahead (H24, H25, H26).
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** True if `date` is further in the future than clock skew can explain. */
export function isImplausiblyFuture(date: Date, referenceMs = Date.now()): boolean {
  return date.getTime() > referenceMs + CLOCK_SKEW_TOLERANCE_MS;
}
