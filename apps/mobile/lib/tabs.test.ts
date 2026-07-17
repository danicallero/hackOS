import { CAPABILITIES } from "@hackos/shared/capabilities";
import { overflowTabs, primaryTabs, shouldUseOverflowMenu, visibleTabs } from "./tabs";

describe("visibleTabs (H55)", () => {
  it("shows only participant tabs with no staff capabilities", () => {
    expect(visibleTabs([])).toEqual(["schedule", "queue", "wallet", "notifications", "account"]);
  });

  it("adds the scan tab for any of the three scan capabilities", () => {
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
});

describe("primaryTabs (H55, issue #187: scan is a one-action entry, never a tap behind an ellipsis)", () => {
  it("shows account as the fifth bar slot with no scan capability", () => {
    expect(primaryTabs([])).toEqual(["schedule", "queue", "wallet", "notifications", "account"]);
  });

  it("promotes scan into the primary bar for any scan-capability holder", () => {
    expect(primaryTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual([
      "schedule",
      "queue",
      "wallet",
      "notifications",
      "scan",
    ]);
    expect(primaryTabs([CAPABILITIES.PRESENCE_SCAN])).toContain("scan");
    expect(primaryTabs([CAPABILITIES.ACTIVITY_SCAN])).toContain("scan");
  });

  it("promotes scan for the admin wildcard too", () => {
    expect(primaryTabs([CAPABILITIES.ADMIN_ALL])).toContain("scan");
  });

  it("never puts scan in the overflow selector", () => {
    for (const caps of [
      [CAPABILITIES.ACCREDIT_SCAN],
      [CAPABILITIES.PRESENCE_SCAN],
      [CAPABILITIES.ACTIVITY_SCAN],
      [CAPABILITIES.ADMIN_ALL],
    ]) {
      expect(overflowTabs(caps)).not.toContain("scan");
      expect(primaryTabs(caps)).toContain("scan");
    }
  });
});

describe("overflowTabs / shouldUseOverflowMenu", () => {
  it("has nothing in overflow with no scan capability", () => {
    expect(overflowTabs([])).toEqual([]);
    expect(shouldUseOverflowMenu([])).toBe(false);
  });

  it("moves account to overflow once scan is promoted", () => {
    expect(overflowTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACCREDIT_SCAN])).toBe(true);
  });

  it("unrelated capabilities don't trigger overflow", () => {
    expect(shouldUseOverflowMenu([CAPABILITIES.SCHEDULE_MANAGE])).toBe(false);
  });
});
