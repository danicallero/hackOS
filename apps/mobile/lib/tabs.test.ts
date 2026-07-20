import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  overflowTabs,
  primaryTabs,
  queueOperationsInPrimaryBar,
  shouldUseOverflowMenu,
  visibleTabs,
} from "./tabs";

describe("visibleTabs (H55)", () => {
  it("shows only participant tabs with no staff capabilities", () => {
    expect(visibleTabs([])).toEqual(["schedule", "queue", "wallet", "notifications", "account"]);
  });

  it("adds the scan destination for any of the three scan capabilities", () => {
    expect(visibleTabs([CAPABILITIES.ACCREDIT_SCAN])).toContain("scan");
    expect(visibleTabs([CAPABILITIES.PRESENCE_SCAN])).toContain("scan");
    expect(visibleTabs([CAPABILITIES.ACTIVITY_SCAN])).toContain("scan");
  });

  it("unrelated capabilities don't unlock scan", () => {
    expect(visibleTabs([CAPABILITIES.SCHEDULE_MANAGE])).not.toContain("scan");
  });

  it("the admin wildcard unlocks scan like every other capability", () => {
    expect(visibleTabs([CAPABILITIES.ADMIN_ALL])).toContain("scan");
  });

  it("only exposes activities to activity scanners and admins", () => {
    expect(visibleTabs([CAPABILITIES.ACCREDIT_SCAN])).not.toContain("activities");
    expect(visibleTabs([CAPABILITIES.ACTIVITY_SCAN])).toContain("activities");
    expect(visibleTabs([CAPABILITIES.ADMIN_ALL])).toContain("activities");
  });
});

describe("primaryTabs (H55; a native tab bar collapses past 5 items into iOS's own 'More')", () => {
  it("shows account as the fifth bar slot with no scan capability", () => {
    expect(primaryTabs([])).toEqual(["schedule", "queue", "wallet", "notifications", "account"]);
  });

  it("replaces queue and wallet with operational tools for staff", () => {
    expect(primaryTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual([
      "schedule",
      "scan",
      "notifications",
    ]);
    expect(primaryTabs([CAPABILITIES.PRESENCE_SCAN])).toContain("scan");
    expect(primaryTabs([CAPABILITIES.ACTIVITY_SCAN])).toEqual([
      "schedule",
      "scan",
      "activities",
      "notifications",
    ]);
  });

  it("always puts scan in the primary bar for operators", () => {
    for (const caps of [
      [CAPABILITIES.ACCREDIT_SCAN],
      [CAPABILITIES.PRESENCE_SCAN],
      [CAPABILITIES.ACTIVITY_SCAN],
      [CAPABILITIES.ADMIN_ALL],
    ]) {
      expect(primaryTabs(caps)).toContain("scan");
      expect(overflowTabs(caps)).not.toContain("scan");
    }
  });
});

describe("overflowTabs / shouldUseOverflowMenu", () => {
  it("has nothing in overflow with no scan capability", () => {
    expect(overflowTabs([])).toEqual([]);
    expect(shouldUseOverflowMenu([])).toBe(false);
  });

  it("moves queue, wallet, and account to overflow for operators", () => {
    expect(overflowTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["queue", "wallet", "account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACCREDIT_SCAN])).toBe(true);
  });

  it("unrelated capabilities don't trigger overflow", () => {
    expect(shouldUseOverflowMenu([CAPABILITIES.SCHEDULE_MANAGE])).toBe(false);
  });

  it("gives queue-only operators a direct Queue operations tab and keeps personal tabs in Others", () => {
    expect(primaryTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual([
      "schedule",
      "operations",
      "notifications",
    ]);
    expect(overflowTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual(["queue", "wallet", "account"]);
    expect(queueOperationsInPrimaryBar([CAPABILITIES.QUEUE_OPERATE])).toBe(true);
  });

  it("puts Queue operations in Others when scanner tools already fill the bar", () => {
    const capabilities = [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.QUEUE_OPERATE];
    expect(primaryTabs(capabilities)).toEqual(["schedule", "scan", "notifications"]);
    expect(overflowTabs(capabilities)).toEqual(["queue", "wallet", "account", "operations"]);
    expect(queueOperationsInPrimaryBar(capabilities)).toBe(false);
  });
});
