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

export const PHYSICAL_STATES = ["called", "in_room", "presenting", "completed"] as const;

export function physicalStateIndex(status: QueueStatus | string | null): number {
  if (!status) return -1;
  return PHYSICAL_STATES.indexOf(status as (typeof PHYSICAL_STATES)[number]);
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

export function workspaceAccess({
  operate,
  judge,
  admin,
  exportData,
}: {
  operate: boolean;
  judge: boolean;
  admin: boolean;
  exportData: boolean;
}) {
  return {
    canUse: operate || judge || admin,
    canOperate: operate,
    canJudge: judge,
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
