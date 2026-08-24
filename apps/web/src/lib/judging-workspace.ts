import type { QueueStatus } from "./queue";

export type JudgingAction =
  | "notify-enter"
  | "bring-in"
  | "start"
  | "complete"
  | "send-back"
  | "re-enter"
  | "requeue"
  | "no-show"
  | "skip"
  | "move-top"
  | "cancel"
  | "disqualify";

/** Mirrors the API state machine; this module only drives affordance visibility. */
export const LEGAL_ACTIONS: Record<string, readonly JudgingAction[]> = {
  waiting: ["skip", "move-top", "cancel", "disqualify"],
  called: [
    "notify-enter",
    "bring-in",
    "requeue",
    "no-show",
    "skip",
    "move-top",
    "cancel",
    "disqualify",
  ],
  in_room: ["start", "send-back", "no-show", "disqualify"],
  presenting: ["complete", "send-back", "disqualify"],
  completed: ["re-enter"],
  cancelled: ["re-enter"],
  disqualified: ["re-enter"],
};

export function canTransition(status: QueueStatus | string, action: JudgingAction): boolean {
  return LEGAL_ACTIONS[status]?.includes(action) ?? false;
}

/**
 * How long a team may sit in `called` before the operator is warned (H34/H203).
 *
 * The operator-configured value (`queue_settings.called_too_long_threshold_minutes`,
 * served on `GET /api/queue/rooms/:id/pace`) wins. The `max(10, 2x desired)`
 * expression is only the fallback for a room view that carries no setting —
 * it used to be the whole rule, before the setting existed.
 */
export function calledTooLongThresholdMinutes(
  desiredMinutesPerTeam: number | null,
  configuredMinutes?: number | null,
): number {
  if (configuredMinutes != null && configuredMinutes > 0) return configuredMinutes;
  return Math.max(10, (desiredMinutesPerTeam ?? 0) * 2);
}

export function hasWaitedTooLong(
  calledAt: string | null,
  desiredMinutesPerTeam: number | null,
  configuredMinutes?: number | null,
  now = Date.now(),
): boolean {
  if (!calledAt) return false;
  const calledMs = new Date(calledAt).getTime();
  if (!Number.isFinite(calledMs)) return false;
  const threshold = calledTooLongThresholdMinutes(desiredMinutesPerTeam, configuredMinutes);
  return now - calledMs >= threshold * 60_000;
}

export type CollaborationState = "saving" | "saved" | "offline" | "conflict" | "unsaved";

/**
 * Judge access is association-based (`enterprise_judges`), not capability-based
 * (H40): a judge added by a sponsor rep can hold zero capabilities and still
 * needs the panel, matching the API's `requireRoomJudgeOrCapability` fallback.
 */
export function workspaceAccess({
  operate,
  judge,
  admin,
  exportData,
  isEnterpriseJudge = false,
}: {
  operate: boolean;
  judge: boolean;
  admin: boolean;
  exportData: boolean;
  isEnterpriseJudge?: boolean;
}) {
  const canJudge = judge || isEnterpriseJudge;
  return {
    canUse: operate || canJudge || admin,
    canOperate: operate,
    canJudge,
    canAdmin: admin,
    canExport: exportData,
  };
}

export function collaborationState({
  online,
  saving,
  conflict,
  dirty,
}: {
  online: boolean;
  saving: boolean;
  conflict: boolean;
  dirty: boolean;
}): CollaborationState {
  if (!online) return "offline";
  if (conflict) return "conflict";
  if (saving) return "saving";
  if (dirty) return "unsaved";
  return "saved";
}

// ── presentation timer (H39) ────────────────────────────────────────────────

export type TimerTone = "default" | "warning" | "danger";

export interface PresentationTimerState {
  elapsedSeconds: number;
  /** Null when the presentation has no capped total to count against. */
  totalSeconds: number | null;
  /** Negative once over time; null without a total. */
  remainingSeconds: number | null;
  /** 0-100, clamped. 0 without a usable total. */
  progressValue: number;
  tone: TimerTone;
}

/**
 * H39: the pace (and its cap/squeeze) is a live value that keeps recomputing as
 * the schedule and pending count change — refetching it mid-presentation must
 * not shift the total the timer counts against, or the remaining/overtime
 * figure would jump around instead of counting smoothly. The total is frozen
 * per presentation (keyed by `startedAt`) and captured once if the pace wasn't
 * ready yet when the presentation began.
 *
 * Pure so the freeze rule is assertable without rendering: the caller holds the
 * previous value in a ref and assigns the result back.
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
 * The stopwatch is not a countdown: elapsed always counts up from 0 and never
 * resets or jumps. Only the tone changes as it crosses thresholds — amber for
 * the last stretch (the greater of 60s and 10% of the total, so short slots
 * still get a usable warning), red once over.
 */
export function presentationTimerState(
  startedAt: string | null,
  totalMinutes: number | null,
  now = Date.now(),
): PresentationTimerState {
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
    remainingSeconds <= Math.max(60, Math.ceil(totalSeconds * 0.1));
  return {
    elapsedSeconds,
    totalSeconds,
    remainingSeconds,
    progressValue,
    tone: isOverTime ? "danger" : isWrappingUp ? "warning" : "default",
  };
}
