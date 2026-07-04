/**
 * H24 — presence estimation (pure, deterministic, unit-tested).
 *
 * We never store presence hours; they are derived on read from three raw
 * signals per user (plan/07, H24):
 *   - door `in`  (time_logs.kind='in')  — arrival.
 *   - door `out` (time_logs.kind='out') — authoritative departure.
 *   - activity   (activity_logs)        — a meal/workshop scan proves the
 *                                          person was present AT that instant.
 *
 * Since "no nos podemos fiar de que todo el mundo avise al salir" (H24), most
 * people never scan `out`. We therefore model presence as a set of intervals
 * built by a single left-to-right walk:
 *
 *   - `in` / `activity` OPEN (or extend) a presumed interval that auto-closes
 *     `PRESUMED_STAY` after the LAST supporting signal. Each new signal within
 *     the still-open window pushes the auto-close forward (so a workshop before
 *     lunch extends the morning: the interval starts at the workshop scan and
 *     stays open through lunch).
 *   - `out` HARD-CLOSES the open interval exactly at the out time, regardless
 *     of the presumed window — an in→out pair is a full continuous session even
 *     with no scans in between (a full working day with a single in and out).
 *   - When the next `in`/`activity` arrives AFTER the presumed window already
 *     lapsed, the previous interval closes at its presumed end and a NEW
 *     interval opens. This is what makes "dinner but no breakfast = slept
 *     elsewhere": the dinner interval closes ~PRESUMED_STAY after dinner and the
 *     overnight gap until the next day's first scan is never credited.
 *
 * Every interval is capped at `MAX_SESSION` so a stray next-day `out` (or an
 * `in` with no follow-up) cannot credit an implausible multi-day block.
 *
 * Determinism: events at the same timestamp are ordered in < activity < out so
 * an open+close at the same instant behaves predictably.
 */

export type PresenceEventKind = "in" | "out" | "activity";

export interface PresenceEvent {
  /** epoch milliseconds */
  t: number;
  kind: PresenceEventKind;
}

export interface Interval {
  /** epoch milliseconds */
  start: number;
  end: number;
}

export interface PresenceOptions {
  /** How long a lone activity/door-in keeps a person "present" absent other
   * signals. Bridges typical event spacing (workshop → lunch). Configurable. */
  presumedStayMs?: number;
  /** Hard cap on any single interval, guards against stray far-apart signals. */
  maxSessionMs?: number;
}

export const DEFAULT_PRESUMED_STAY_MS = 180 * 60_000; // 3h
export const DEFAULT_MAX_SESSION_MS = 16 * 60 * 60_000; // 16h

const KIND_ORDER: Record<PresenceEventKind, number> = { in: 0, activity: 1, out: 2 };

/**
 * Build the closed presence intervals implied by `events`, considering only
 * signals at or before `cutoff`. A currently-open interval is closed at
 * min(presumedClose, cutoff) so occupancy queries never credit the future.
 */
export function buildPresenceIntervals(
  events: PresenceEvent[],
  cutoff: number,
  opts: PresenceOptions = {},
): Interval[] {
  const stay = opts.presumedStayMs ?? DEFAULT_PRESUMED_STAY_MS;
  const maxSession = opts.maxSessionMs ?? DEFAULT_MAX_SESSION_MS;

  const sorted = events
    .filter((e) => e.t <= cutoff)
    .sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const intervals: Interval[] = [];
  let open = false;
  let start = 0;
  let presumedClose = 0;

  const close = (end: number): void => {
    const bounded = Math.min(end, start + maxSession);
    if (bounded > start) intervals.push({ start, end: bounded });
    open = false;
  };

  for (const ev of sorted) {
    // A pending presumed window lapses before the next arrival/activity
    // (but never before an authoritative `out`, which reaches back to `start`).
    if (open && ev.kind !== "out" && ev.t > presumedClose) close(presumedClose);

    if (ev.kind === "out") {
      if (open) close(ev.t);
      continue;
    }

    // in | activity — open a new interval or extend the live one.
    if (!open) {
      open = true;
      start = ev.t;
      presumedClose = ev.t + stay;
    } else {
      presumedClose = Math.max(presumedClose, ev.t + stay);
    }
  }

  if (open) close(Math.min(presumedClose, cutoff));
  return intervals;
}

/** Total presumed presence in ms up to `cutoff`. */
export function totalPresenceMs(
  events: PresenceEvent[],
  cutoff: number,
  opts: PresenceOptions = {},
): number {
  return buildPresenceIntervals(events, cutoff, opts).reduce((s, i) => s + (i.end - i.start), 0);
}

/** Whether the person is estimated present at instant `at` (for occupancy). */
export function isPresentAt(
  events: PresenceEvent[],
  at: number,
  opts: PresenceOptions = {},
): boolean {
  const intervals = buildPresenceIntervals(events, at, opts);
  return intervals.some((i) => i.start <= at && at <= i.end);
}
