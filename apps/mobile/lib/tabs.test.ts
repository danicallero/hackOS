import { CAPABILITIES } from "@hackos/shared/capabilities";
import { visibleTabs } from "./tabs";

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
