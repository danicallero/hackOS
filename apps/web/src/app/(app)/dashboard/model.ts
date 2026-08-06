import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";

export type DashboardQuickAction =
  | "wallet"
  | "applications"
  | "challenges"
  | "judging"
  | "logistics"
  | "queueOperations"
  | "eventSettings"
  | "schedule";

export type DashboardPrimaryAction = Exclude<DashboardQuickAction, "wallet">;

export interface DashboardAccessContext {
  can: (capability: Capability) => boolean;
  isRoomJudge: boolean;
  isSponsorRep: boolean;
}

function canAny(context: DashboardAccessContext, capabilities: Capability[]): boolean {
  return capabilities.some((capability) => context.can(capability));
}

/**
 * Dashboard shortcuts mirror the additive workspaces. `role` remains a
 * display field only: association facts and effective capabilities decide
 * which destinations remain useful to this account (H8/H55).
 */
export function dashboardQuickActions(context: DashboardAccessContext): DashboardQuickAction[] {
  const actions: DashboardQuickAction[] = ["wallet"];

  if (
    context.isSponsorRep ||
    canAny(context, [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN])
  ) {
    actions.push("challenges");
  }

  if (
    context.isRoomJudge ||
    canAny(context, [
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
    ])
  ) {
    actions.push("judging");
  }

  if (
    canAny(context, [
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.ACTIVITY_SCAN,
      CAPABILITIES.PRESENCE_SCAN,
      CAPABILITIES.LOGISTICS_STATS,
    ])
  ) {
    actions.push("logistics");
  }

  if (
    canAny(context, [
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
    ])
  ) {
    actions.push("queueOperations");
  }

  if (context.can(CAPABILITIES.SCHEDULE_MANAGE)) actions.push("eventSettings");

  actions.push("schedule");
  return actions;
}

/** Pick one starting point so the dashboard does not become a second sidebar. */
export function dashboardPrimaryAction(context: DashboardAccessContext): DashboardPrimaryAction {
  if (
    context.isRoomJudge ||
    canAny(context, [
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
    ])
  ) {
    return "judging";
  }
  if (canAny(context, [CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE])) {
    return "applications";
  }
  if (
    context.isSponsorRep ||
    canAny(context, [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN])
  ) {
    return "challenges";
  }
  if (
    canAny(context, [
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.ACTIVITY_SCAN,
      CAPABILITIES.PRESENCE_SCAN,
      CAPABILITIES.LOGISTICS_STATS,
    ])
  ) {
    return "logistics";
  }
  if (context.can(CAPABILITIES.SCHEDULE_MANAGE)) return "eventSettings";
  return "schedule";
}
