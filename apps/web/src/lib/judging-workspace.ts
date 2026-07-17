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

/** Temporary UX warning rule approved for #190; backend follow-up will make it configurable. */
export function calledTooLongThresholdMinutes(desiredMinutesPerTeam: number | null): number {
  return Math.max(10, (desiredMinutesPerTeam ?? 0) * 2);
}

export function hasWaitedTooLong(
  calledAt: string | null,
  desiredMinutesPerTeam: number | null,
  now = Date.now(),
): boolean {
  if (!calledAt) return false;
  const calledMs = new Date(calledAt).getTime();
  if (!Number.isFinite(calledMs)) return false;
  return now - calledMs >= calledTooLongThresholdMinutes(desiredMinutesPerTeam) * 60_000;
}

export type CollaborationState = "saving" | "saved" | "offline" | "conflict" | "unsaved";

/**
 * Judge access is association-based (`room_judges`), not capability-based
 * (H40): a judge added by a sponsor rep can hold zero capabilities and still
 * needs the panel, matching the API's `requireRoomJudgeOrCapability` fallback.
 */
export function workspaceAccess({
  operate,
  judge,
  admin,
  exportData,
  isRoomJudge = false,
}: {
  operate: boolean;
  judge: boolean;
  admin: boolean;
  exportData: boolean;
  isRoomJudge?: boolean;
}) {
  const canJudge = judge || isRoomJudge;
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
