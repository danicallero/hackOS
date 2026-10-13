export {
  durationMinutes,
  guaranteedMinutes,
  provisionalMinutes,
} from "@hackos/shared/presence-timeline";

import type {
  PresenceCertaintyWindow,
  PresenceConflict,
  PresenceTimelineSignal,
} from "./logistics";

export interface PresenceTimelineRow {
  signal: PresenceTimelineSignal;
  window: PresenceCertaintyWindow | null;
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
