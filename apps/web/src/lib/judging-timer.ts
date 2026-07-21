/**
 * H34/H39 presentation timer arithmetic, extracted from the judging page's
 * `PresentationTimer` so the tone cutoffs and the frozen-total rule are
 * assertable without rendering the route. The JSX stays in `page.tsx`.
 */

export type TimerTone = "default" | "warning" | "danger";

export interface PresentationTimerState {
  /** Frozen presentation length in seconds; null when the pace is unknown. */
  totalSeconds: number | null;
  /** Stopwatch value: always counts up from 0, never resets or jumps. */
  elapsedSeconds: number;
  /** Negative once the team is over the (advisory) limit; null without a total. */
  remainingSeconds: number | null;
  /** 0-100 for the progress bar; 0 when there is no usable total. */
  progressValue: number;
  isOverTime: boolean;
  isWrappingUp: boolean;
  tone: TimerTone;
}

/**
 * The pace read keeps recomputing as the schedule and pending count change
 * (H39), so refetching it mid-presentation must not shift the total this timer
 * counts against. The total is frozen per presentation (keyed by `startedAt`)
 * and captured once if it wasn't ready yet when the presentation began.
 */
export function freezeTotalMinutes(
  previous: { key: string | null; minutes: number | null },
  startedAt: string | null,
  totalMinutes: number | null,
): { key: string | null; minutes: number | null } {
  if (previous.key !== startedAt) return { key: startedAt, minutes: totalMinutes };
  if (previous.minutes == null && totalMinutes != null)
    return { key: previous.key, minutes: totalMinutes };
  return previous;
}

/**
 * Wrap-up cue: the last tenth of the slot, but never less than a full minute
 * of warning on very short slots. Over-time is advisory only — nothing
 * server-side ends an evaluation on a clock.
 */
export function wrapUpThresholdSeconds(totalSeconds: number): number {
  return Math.max(60, Math.ceil(totalSeconds * 0.1));
}

export function presentationTimerState({
  startedAt,
  totalMinutes,
  now,
}: {
  startedAt: string | null;
  /** Already capped by the challenge's max and squeezed for remaining time (H39). */
  totalMinutes: number | null;
  now: number;
}): PresentationTimerState {
  const totalSeconds = totalMinutes != null ? Math.round(totalMinutes * 60) : null;
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSeconds =
    startedMs && Number.isFinite(startedMs) ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
  const remainingSeconds = totalSeconds != null ? totalSeconds - elapsedSeconds : null;
  const progressValue =
    totalSeconds && totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;
  const isOverTime = remainingSeconds != null && remainingSeconds < 0;
  const isWrappingUp =
    !isOverTime &&
    remainingSeconds != null &&
    totalSeconds != null &&
    totalSeconds > 0 &&
    remainingSeconds <= wrapUpThresholdSeconds(totalSeconds);
  return {
    totalSeconds,
    elapsedSeconds,
    remainingSeconds,
    progressValue,
    isOverTime,
    isWrappingUp,
    tone: isOverTime ? "danger" : isWrappingUp ? "warning" : "default",
  };
}
