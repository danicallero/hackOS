/**
 * H24 — presence estimation (pure, deterministic, unit-tested).
 *
 * IMPORTANT — this module never represents ground truth, and it never closes
 * anything. Raw session state (whether a person's door session is open or
 * closed) lives entirely in `time_logs` and is enforced at write time in
 * `presence.ts`: an `in` opens a session, and ONLY a real `out` scan — live
 * or backdated/manual — ever closes it. The system never invents an `out`.
 *
 * What lives here is a read-only LIKELIHOOD estimate — "how much of this
 * open-ended session is plausible presence, for hours/occupancy purposes" —
 * built on read from three raw signals per user (plan/07, H24):
 *   - door `in`  (time_logs.kind='in')  — arrival.
 *   - door `out` (time_logs.kind='out') — authoritative departure.
 *   - activity   (activity_logs)        — a meal/workshop scan proves the
 *                                          person was present AT that instant.
 *
 * Since "no nos podemos fiar de que todo el mundo avise al salir" (H24), most
 * people never scan `out`. We therefore model estimated presence as a set of
 * intervals built by a single left-to-right walk:
 *
 *   - `in` / `activity` OPEN (or extend) an interval whose credited time stops
 *     growing `SUSPICIOUS_GAP` after the LAST supporting signal — not because
 *     we believe the person left then, but because crediting hours/occupancy
 *     further without any signal stops being plausible. Each new signal within
 *     the still-credited window pushes that point forward (so a workshop before
 *     lunch extends the morning: the interval starts at the workshop scan and
 *     stays credited through lunch). `SUSPICIOUS_GAP` defaults to a window wider
 *     than the normal same-day gap between meals/activities (so a quiet
 *     afternoon of hacking with no scan isn't mistaken for having left), but
 *     narrower than an overnight gap (so "dinner but no breakfast" still
 *     reads as having slept elsewhere, per the story's canonical example).
 *   - `out` HARD-CLOSES the open interval exactly at the out time, regardless
 *     of the window — an in→out pair is a full continuous session even
 *     with no scans in between (a full working day with a single in and out).
 *   - When the next `in`/`activity` arrives AFTER the window already lapsed,
 *     the previous interval stops accruing credited time at its estimated end
 *     and a NEW interval opens for the next signal. This is what makes "dinner
 *     but no breakfast = slept elsewhere": the dinner interval stops crediting
 *     ~SUSPICIOUS_GAP after dinner and the overnight gap until the next day's
 *     first scan is never credited.
 *
 * Every interval carries `confirmed`: true when it was hard-closed by a real
 * door `out` scan, false when the end is estimated — either the suspicious-gap
 * window lapsed with no supporting signal, or the interval is still open and
 * was simply cut off at `cutoff` (now) for the purpose of this read. A `false`
 * value is NOT a claim that the person left the venue — see `presence.ts`'s
 * `hasOpenSession` for whether their raw door session is actually still open.
 * Callers (admin UI) use `confirmed` to show "estimated" vs "confirmed"
 * instead of presenting an inferred gap as if it were a real recorded exit.
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
  /** True when `end` is a real door `out` scan; false when it's inferred
   * (presumed-stay window lapsed, or still open and cut off at `cutoff`). */
  confirmed: boolean;
}

export interface PresenceOptions {
  /** How long a lone activity/door-in keeps crediting a person as "present"
   * absent any other signal. Bridges typical same-day event spacing
   * (workshop → lunch → dinner). Once a gap exceeds this with zero signals,
   * the gap itself stops being credited AND is flagged suspicious for staff
   * to double-check (see `presence.ts`'s `openSessions`) — it does not mean
   * the raw session is closed. Configurable. */
  suspiciousGapMs?: number;
  /** Hard cap on any single interval, guards against stray far-apart signals. */
  maxSessionMs?: number;
}

// Wider than a typical same-day gap between meals/activities (lunch→dinner is
// commonly ~7h) but narrower than an overnight gap (dinner→breakfast is
// commonly ~12h+), so a quiet stretch of hacking doesn't read as suspicious
// while sleeping elsewhere still does.
export const DEFAULT_SUSPICIOUS_GAP_MS = 12 * 60 * 60_000; // 12h
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
  const gap = opts.suspiciousGapMs ?? DEFAULT_SUSPICIOUS_GAP_MS;
  const maxSession = opts.maxSessionMs ?? DEFAULT_MAX_SESSION_MS;

  const sorted = events
    .filter((e) => e.t <= cutoff)
    .sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const intervals: Interval[] = [];
  let open = false;
  let start = 0;
  let presumedClose = 0;

  const close = (end: number, confirmed: boolean): void => {
    const bounded = Math.min(end, start + maxSession);
    if (bounded > start) intervals.push({ start, end: bounded, confirmed });
    open = false;
  };

  for (const ev of sorted) {
    // A pending presumed window lapses before the next arrival/activity
    // (but never before an authoritative `out`, which reaches back to `start`).
    if (open && ev.kind !== "out" && ev.t > presumedClose) close(presumedClose, false);

    if (ev.kind === "out") {
      if (open) close(ev.t, true);
      continue;
    }

    // in | activity — open a new interval or extend the live one.
    if (!open) {
      open = true;
      start = ev.t;
      presumedClose = ev.t + gap;
    } else {
      presumedClose = Math.max(presumedClose, ev.t + gap);
    }
  }

  if (open) close(Math.min(presumedClose, cutoff), false);
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
