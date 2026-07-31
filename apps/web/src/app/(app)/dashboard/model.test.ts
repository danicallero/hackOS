import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { type DashboardAccessContext, dashboardQuickActions } from "./model";

function contextFor(
  capabilities: Capability[],
  associations: { isRoomJudge?: boolean; isSponsorRep?: boolean } = {},
): DashboardAccessContext {
  const granted = new Set(capabilities);
  const can = (capability: Capability) =>
    granted.has(CAPABILITIES.ADMIN_ALL) || granted.has(capability);
  return {
    can,
    isRoomJudge: associations.isRoomJudge ?? false,
    isSponsorRep: associations.isSponsorRep ?? false,
  };
}

describe("dashboard quick actions (H8/H55)", () => {
  it("shows sponsor and judging destinations together for a sponsor representative assigned to a room", () => {
    expect(
      dashboardQuickActions(contextFor([], { isSponsorRep: true, isRoomJudge: true })),
    ).toEqual(["wallet", "challenges", "judging", "schedule"]);
  });

  it("uses the actual capability for each operational shortcut", () => {
    expect(dashboardQuickActions(contextFor([CAPABILITIES.ACCREDIT_SCAN]))).toEqual([
      "wallet",
      "logistics",
      "schedule",
    ]);
    expect(dashboardQuickActions(contextFor([CAPABILITIES.QUEUE_OPERATE]))).toEqual([
      "wallet",
      "judging",
      "queueOperations",
      "schedule",
    ]);
    expect(dashboardQuickActions(contextFor([CAPABILITIES.SCHEDULE_MANAGE]))).toEqual([
      "wallet",
      "eventSettings",
      "schedule",
    ]);
  });

  it("keeps illustrative roles out of the access decision and honors the admin wildcard", () => {
    expect(dashboardQuickActions(contextFor([CAPABILITIES.ADMIN_ALL]))).toEqual([
      "wallet",
      "challenges",
      "judging",
      "logistics",
      "queueOperations",
      "eventSettings",
      "schedule",
    ]);
  });
});
