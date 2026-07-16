/**
 * Pure presence-credit calculation. An entry or activity opens a provisional
 * session. An exit inside the configured certainty window confirms the whole
 * interval; an activity inside it confirms time up to that signal and renews
 * the window. If the window expires without either signal, the provisional
 * part is worth zero hours. Raw logs remain untouched for manual review.
 *
 * Illegal state (H24): two consecutive door `in` signals with no exit or
 * activity between them. The second `in` proves the person was *outside* just
 * before it, so it cannot secure the previous entry's window — that window is
 * marked `conflict` and credits zero hours until staff insert the missing
 * exit/activity. The scan endpoint rejects this sequence at write time; it can
 * only appear through manual log edits.
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
  /** True when `end` is a real door `out`; false for activity-backed/provisional time. */
  confirmed: boolean;
}

export interface PresenceOptions {
  /** Time allowed for an exit/activity to validate the provisional session. */
  suspiciousGapMs?: number;
}

export interface CertaintyWindow {
  start: number;
  deadline: number;
  securedUntil: number | null;
  status: "secured" | "provisional" | "invalid";
  openedBy: "in" | "activity";
  closedBy: PresenceEventKind | null;
  /** True when a second door `in` arrived before any exit/activity closed this window. */
  conflict: boolean;
}

// Default policy; event_config can override it.
export const DEFAULT_SUSPICIOUS_GAP_MS = 12 * 60 * 60_000; // 12h

const KIND_ORDER: Record<PresenceEventKind, number> = { in: 0, activity: 1, out: 2 };

/** Explain the rolling certainty policy one window at a time for admin UI. */
export function buildCertaintyWindows(
  events: PresenceEvent[],
  cutoff: number,
  opts: PresenceOptions = {},
): CertaintyWindow[] {
  const gap = opts.suspiciousGapMs ?? DEFAULT_SUSPICIOUS_GAP_MS;
  const sorted = events
    .filter((event) => event.t <= cutoff)
    .sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const windows: CertaintyWindow[] = [];
  let active: CertaintyWindow | null = null;
  let prevKind: PresenceEventKind | null = null;

  for (const event of sorted) {
    if (active && event.t > active.deadline) {
      active.status = "invalid";
      active = null;
    }

    if (event.kind === "out") {
      if (active && event.t <= active.deadline) {
        active.securedUntil = event.t;
        active.closedBy = "out";
        active.status = "secured";
      }
      active = null;
      prevKind = "out";
      continue;
    }

    if (event.kind === "in" && prevKind === "in") {
      // Illegal in→in: the previous entry's window can't be trusted — the
      // person was outside just before this scan. Zero credit until staff
      // insert the missing exit/activity between the two entries.
      const previous = windows[windows.length - 1];
      if (previous) {
        previous.status = "invalid";
        previous.conflict = true;
      }
      active = null;
    } else if (active && event.t <= active.deadline) {
      active.securedUntil = event.t;
      active.closedBy = event.kind;
      active.status = "secured";
    }

    const next: CertaintyWindow = {
      start: event.t,
      deadline: event.t + gap,
      securedUntil: null,
      status: event.t + gap < cutoff ? "invalid" : "provisional",
      openedBy: event.kind,
      closedBy: null,
      conflict: false,
    };
    windows.push(next);
    active = next;
    prevKind = event.kind;
  }

  if (active && active.securedUntil == null) {
    active.status = active.deadline < cutoff ? "invalid" : "provisional";
  }
  return windows;
}

/**
 * Build credited intervals from signals at or before `cutoff`. An active
 * provisional interval is shown up to cutoff; after expiry it disappears
 * unless another signal validated part of it.
 */
export function buildPresenceIntervals(
  events: PresenceEvent[],
  cutoff: number,
  opts: PresenceOptions = {},
): Interval[] {
  return buildCertaintyWindows(events, cutoff, opts).flatMap((window) => {
    if (window.status === "invalid") return [];
    const end = window.securedUntil ?? Math.min(window.deadline, cutoff);
    if (end <= window.start) return [];
    return [
      {
        start: window.start,
        end,
        confirmed: window.closedBy === "out",
      },
    ];
  });
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
