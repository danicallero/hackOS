import type {
  PresenceCertaintyWindow,
  PresenceConflict,
  PresenceTimelineSignal,
} from "./logistics";

export interface PresenceTimelineRow {
  signal: PresenceTimelineSignal;
  window: PresenceCertaintyWindow | null;
}

export function durationMinutes(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
}

export function guaranteedMinutes(windows: PresenceCertaintyWindow[]): number {
  return windows.reduce(
    (total, window) =>
      total + (window.securedUntil ? durationMinutes(window.start, window.securedUntil) : 0),
    0,
  );
}

export function provisionalMinutes(windows: PresenceCertaintyWindow[], now = Date.now()): number {
  return windows.reduce((total, window) => {
    if (window.securedUntil || window.status !== "provisional") return total;
    const end = Math.min(now, Date.parse(window.deadline));
    return total + Math.max(0, Math.round((end - Date.parse(window.start)) / 60_000));
  }, 0);
}

/**
 * Pair each entry/activity with the certainty window it opened, keeping exits
 * in the same chronological list. The newest signal is shown first for the
 * profile workflow (H24).
 */
export function timelineRows(
  signals: PresenceTimelineSignal[],
  windows: PresenceCertaintyWindow[],
): PresenceTimelineRow[] {
  let windowIndex = 0;
  return signals
    .map((signal) => ({
      signal,
      window: signal.kind === "out" ? null : (windows[windowIndex++] ?? null),
    }))
    .reverse();
}

export function conflictBounds(conflict: PresenceConflict): { min: Date; max: Date } {
  return { min: new Date(conflict.from), max: new Date(conflict.to) };
}
