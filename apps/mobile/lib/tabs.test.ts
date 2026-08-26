import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  OVERFLOW_TAB_ICON,
  OVERFLOW_TAB_KEYS,
  OVERFLOW_TAB_LABEL_KEY,
  OVERFLOW_TAB_ROUTE,
} from "./overflow-tabs";
import {
  isPadIdiomForPlatform,
  overflowTabs,
  primaryTabs,
  queueOperationsInPrimaryBar,
  shouldUseOverflowMenu,
  visibleTabs,
} from "./tabs";

describe("visibleTabs (H55)", () => {
  it("hides My queue before accreditation when the user has no queue entry", () => {
    expect(visibleTabs([])).toEqual(["schedule", "wallet", "notifications", "account"]);
  });

  it("shows My queue after accreditation or when an exceptional queue entry exists", () => {
    expect(visibleTabs([], { accredited: true, hasQueueItems: false })).toContain("queue");
    expect(visibleTabs([], { accredited: false, hasQueueItems: true })).toContain("queue");
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

describe("primaryTabs (H55; the custom bar keeps five direct tabs when they fit)", () => {
  it("keeps Account in Others while preserving Wallet before accreditation", () => {
    expect(primaryTabs([])).toEqual(["schedule", "wallet", "notifications"]);
    expect(primaryTabs([], { accredited: true, hasQueueItems: false })).toEqual([
      "schedule",
      "queue",
      "wallet",
      "notifications",
    ]);
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
  it("keeps Account behind Others for participants", () => {
    expect(overflowTabs([])).toEqual(["account"]);
    expect(shouldUseOverflowMenu([])).toBe(false);
  });

  it("moves queue, wallet, and account to overflow for operators", () => {
    expect(overflowTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["wallet", "account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACCREDIT_SCAN])).toBe(false);
  });

  it("keeps Account behind Others for unrelated capabilities", () => {
    expect(overflowTabs([CAPABILITIES.SCHEDULE_MANAGE])).toEqual(["account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.SCHEDULE_MANAGE])).toBe(false);
  });

  it("gives queue-only operators a direct Queue operations tab and keeps personal tabs in Others", () => {
    expect(primaryTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual([
      "schedule",
      "operations",
      "notifications",
    ]);
    expect(overflowTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual(["wallet", "account"]);
    expect(queueOperationsInPrimaryBar([CAPABILITIES.QUEUE_OPERATE])).toBe(true);
  });

  it("puts Queue operations in Others when scanner tools already fill the bar", () => {
    const capabilities = [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.QUEUE_OPERATE];
    expect(primaryTabs(capabilities)).toEqual(["schedule", "scan", "notifications"]);
    expect(overflowTabs(capabilities)).toEqual(["wallet", "account", "operations"]);
    expect(queueOperationsInPrimaryBar(capabilities)).toBe(false);
  });
});

describe("overflow destination descriptors (shared by the custom menu and fallback hub)", () => {
  it("has an icon, a route, and a label key for every overflow destination", () => {
    for (const key of OVERFLOW_TAB_KEYS) {
      expect(OVERFLOW_TAB_ICON[key]).toEqual(expect.any(String));
      expect(OVERFLOW_TAB_ROUTE[key]).toBe(`/(tabs)/others/${key}`);
      expect(OVERFLOW_TAB_LABEL_KEY[key]).toEqual(expect.any(String));
    }
  });
});

describe("isPadIdiom", () => {
  it('is true on iPad — and identically on a Mac running this build "Designed for iPad", since both report the `.pad` idiom', () => {
    expect(isPadIdiomForPlatform({ OS: "ios", isPad: true })).toBe(true);
  });

  it("is false on iPhone, while the custom bar keeps the same bottom geometry", () => {
    expect(isPadIdiomForPlatform({ OS: "ios", isPad: false })).toBe(false);
  });

  it("is false on Android regardless of `isPad`, since the tab bar is cross-platform", () => {
    expect(isPadIdiomForPlatform({ OS: "android", isPad: true })).toBe(false);
  });
});
