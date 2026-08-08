import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import {
  type DashboardAccessContext,
  dashboardPrimaryAction,
  dashboardQuickActions,
} from "./model";

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
    expect(dashboardQuickActions(contextFor([CAPABILITIES.VENUE_MANAGE]))).toEqual([
      "wallet",
      "eventSettings",
      "schedule",
    ]);
    // SCHEDULE_MANAGE's own domain is agenda items — it no longer unlocks
    // Event Settings (that split into EVENT_MANAGE/VENUE_MANAGE/WALLET_MANAGE/
    // PRESENCE_MANAGE/INVITES_MANAGE, one per settings tab).
    expect(dashboardQuickActions(contextFor([CAPABILITIES.SCHEDULE_MANAGE]))).toEqual([
      "wallet",
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

describe("dashboard primary action (UX-02)", () => {
  it("prioritizes the active judging workflow", () => {
    expect(dashboardPrimaryAction(contextFor([CAPABILITIES.QUEUE_OPERATE]))).toBe("judging");
  });

  it("keeps sponsor and participant destinations additive", () => {
    expect(dashboardPrimaryAction(contextFor([], { isSponsorRep: true }))).toBe("challenges");
    expect(dashboardPrimaryAction(contextFor([]))).toBe("schedule");
  });
});
