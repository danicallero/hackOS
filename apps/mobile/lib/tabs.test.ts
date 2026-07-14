import { CAPABILITIES } from "@hackos/shared/capabilities";
import { overflowTabs, shouldUseOverflowMenu, visibleTabs } from "./tabs";

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

  it("puts every tab outside the primary bar in the overflow selector", () => {
    expect(overflowTabs([])).toEqual(["account"]);
    expect(overflowTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["account", "scan"]);
  });

  it("uses five regular tabs until a sixth tab requires overflow", () => {
    expect(shouldUseOverflowMenu([])).toBe(false);
    expect(shouldUseOverflowMenu([CAPABILITIES.SCHEDULE_MANAGE])).toBe(false);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACCREDIT_SCAN])).toBe(true);
  });
});
