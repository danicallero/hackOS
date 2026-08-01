import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  OVERFLOW_TAB_ICON,
  OVERFLOW_TAB_LABEL_KEY,
  OVERFLOW_TAB_ROUTE,
  type OverflowTabKey,
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

describe("overflow destination descriptors (shared by the iPhone popover and the iPad/macOS hub list)", () => {
  const keys: OverflowTabKey[] = ["queue", "wallet", "account", "operations"];

  it("has an icon, a route, and a label key for every overflow destination", () => {
    for (const key of keys) {
      expect(OVERFLOW_TAB_ICON[key]).toEqual(expect.any(String));
      expect(OVERFLOW_TAB_ROUTE[key]).toBe(`/(tabs)/others/${key}`);
      expect(OVERFLOW_TAB_LABEL_KEY[key]).toEqual(expect.any(String));
    }
  });
});

describe("isPadIdiom", () => {
  function isPadIdiomWith(platform: { OS: string; isPad?: boolean }): boolean {
    let result: boolean | undefined;
    jest.isolateModules(() => {
      jest.doMock("react-native", () => ({ Platform: platform }));
      result = (require("./tabs") as typeof import("./tabs")).isPadIdiom();
    });
    return result as boolean;
  }

  it('is true on iPad — and identically on a Mac running this build "Designed for iPad", since both report the `.pad` idiom', () => {
    expect(isPadIdiomWith({ OS: "ios", isPad: true })).toBe(true);
  });

  it("is false on iPhone, which keeps the bottom-anchored popover", () => {
    expect(isPadIdiomWith({ OS: "ios", isPad: false })).toBe(false);
  });

  it("is false on Android regardless of `isPad`, since NativeTabs there is never top-anchored", () => {
    expect(isPadIdiomWith({ OS: "android", isPad: true })).toBe(false);
  });
});
