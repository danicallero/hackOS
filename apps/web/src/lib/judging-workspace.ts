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
 * H34/H203: the operator-configured `calledTooLongThresholdMinutes` (room queue
 * settings, served on the pace read) wins whenever it is present. The
 * `max(10, 2x desired)` expression is only the fallback for rooms whose
 * settings predate the column, or reads that don't carry it.
 */
export function calledTooLongThresholdMinutes(
  desiredMinutesPerTeam: number | null,
  configuredMinutes: number | null = null,
): number {
  if (configuredMinutes != null && Number.isFinite(configuredMinutes) && configuredMinutes > 0) {
    return configuredMinutes;
  }
  return Math.max(10, (desiredMinutesPerTeam ?? 0) * 2);
}

export function hasWaitedTooLong(
  calledAt: string | null,
  desiredMinutesPerTeam: number | null,
  configuredMinutes: number | null = null,
  now = Date.now(),
): boolean {
  if (!calledAt) return false;
  const calledMs = new Date(calledAt).getTime();
  if (!Number.isFinite(calledMs)) return false;
  return (
    now - calledMs >=
    calledTooLongThresholdMinutes(desiredMinutesPerTeam, configuredMinutes) * 60_000
  );
}

/**
 * H34/H35 no-show ladder affordances for a team at the door. Extracted from
 * `CalledEntryActions` so the rules sit next to `LEGAL_ACTIONS`/`canTransition`:
 * a viewer who is neither judge nor operator (a moderator/admin looking on)
 * may not touch the door at all, only a judge can physically bring a team in,
 * and disqualification — the end of the ladder — stays admin-only.
 */
export function calledEntryAffordances({
  busy,
  canJudge,
  canOperate,
  canAdmin,
}: {
  busy: boolean;
  canJudge: boolean;
  canOperate: boolean;
  canAdmin: boolean;
}) {
  const canAct = canJudge || canOperate;
  return {
    canNotifyEnter: !busy && canAct,
    canBringIn: !busy && canJudge,
    canOpenMore: !busy && canAct,
    canDisqualify: canAdmin,
  };
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
