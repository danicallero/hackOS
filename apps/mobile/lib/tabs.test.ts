import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  OVERFLOW_TAB_ICON,
  OVERFLOW_TAB_KEYS,
  OVERFLOW_TAB_LABEL_KEY,
  OVERFLOW_TAB_ROUTE,
} from "./overflow-tabs";
import {
  canManageSchedule,
  canManageStands,
  canReadFullSchedule,
  isPadIdiomForPlatform,
  overflowTabs,
  primaryTabs,
  queueOperationsInPrimaryBar,
  shouldUseOverflowMenu,
  visibleTabs,
} from "./tabs";

describe("visibleTabs (H55)", () => {
  it("hides My queue for non-participants with no queue entry", () => {
    expect(visibleTabs([])).toEqual(["schedule", "diary", "account"]);
  });

  it("shows My queue to accounts with the personal queue capability", () => {
    expect(visibleTabs([CAPABILITIES.QUEUE_STATUS])).toContain("queue");
  });

  it("shows My queue to any account that has a queue entry", () => {
    expect(visibleTabs([], { hasQueueItems: true })).toContain("queue");
  });

  it("does not infer Queue access from a display role", () => {
    expect(visibleTabs([], { hasQueueItems: false })).not.toContain("queue");
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
  it("leaves Wallet out of the bar; it opens from Account (H28)", () => {
    expect(primaryTabs([])).toEqual(["schedule"]);
    expect(primaryTabs([CAPABILITIES.QUEUE_STATUS])).toEqual(["schedule", "queue"]);
  });

  it("replaces queue with operational tools for staff", () => {
    expect(primaryTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["schedule", "scan"]);
    expect(primaryTabs([CAPABILITIES.PRESENCE_SCAN])).toContain("scan");
    expect(primaryTabs([CAPABILITIES.ACTIVITY_SCAN])).toEqual(["schedule", "scan", "activities"]);
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
  it("keeps the diary and Account direct for participants without a queue (#935)", () => {
    expect(overflowTabs([])).toEqual(["diary", "account"]);
    expect(shouldUseOverflowMenu([])).toBe(false);
  });

  it("keeps five destinations direct once My queue joins the bar (#935)", () => {
    expect(visibleTabs([CAPABILITIES.QUEUE_STATUS])).toEqual([
      "schedule",
      "queue",
      "diary",
      "account",
    ]);
    expect(shouldUseOverflowMenu([CAPABILITIES.QUEUE_STATUS])).toBe(false);
  });

  it("uses Others for operators only when the set exceeds five", () => {
    expect(overflowTabs([CAPABILITIES.ACCREDIT_SCAN])).toEqual(["diary", "account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACCREDIT_SCAN])).toBe(false);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACTIVITY_SCAN])).toBe(false);
    expect(shouldUseOverflowMenu([CAPABILITIES.ACTIVITY_SCAN, CAPABILITIES.QUEUE_OPERATE])).toBe(
      true,
    );
  });

  it("keeps Account behind Others for unrelated capabilities", () => {
    expect(overflowTabs([CAPABILITIES.SCHEDULE_MANAGE])).toEqual(["diary", "account"]);
    expect(shouldUseOverflowMenu([CAPABILITIES.SCHEDULE_MANAGE])).toBe(false);
  });

  it("gives queue-only operators a direct Queue operations tab and keeps personal tabs in Others", () => {
    expect(primaryTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual(["schedule", "operations"]);
    expect(overflowTabs([CAPABILITIES.QUEUE_OPERATE])).toEqual(["diary", "account"]);
    expect(queueOperationsInPrimaryBar([CAPABILITIES.QUEUE_OPERATE])).toBe(true);
  });

  it("puts Queue operations in Others when scanner tools already fill the bar", () => {
    const capabilities = [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.QUEUE_OPERATE];
    expect(primaryTabs(capabilities)).toEqual(["schedule", "scan"]);
    expect(overflowTabs(capabilities)).toEqual(["diary", "operations", "account"]);
    expect(queueOperationsInPrimaryBar(capabilities)).toBe(false);
  });
});

describe("Account is the last overflow destination (H55)", () => {
  const personal = { hasQueueItems: true };
  it.each([
    ["operator", [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.QUEUE_OPERATE]],
    ["queue operator", [CAPABILITIES.QUEUE_OPERATE]],
    ["participant with queue", [CAPABILITIES.QUEUE_STATUS]],
  ])("%s", (_name, caps) => {
    const tabs = overflowTabs(caps, personal);
    expect(tabs.at(-1)).toBe("account");
    expect(visibleTabs(caps, personal).at(-1)).toBe("account");
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

describe("canManageStands (#935)", () => {
  it("is the global sponsor administrator capability, like the web Stands page", () => {
    expect(canManageStands([CAPABILITIES.SPONSORS_MANAGE])).toBe(true);
    expect(canManageStands([CAPABILITIES.ADMIN_ALL])).toBe(true);
    expect(canManageStands([CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.QUEUE_ADMIN])).toBe(false);
    expect(canManageStands([])).toBe(false);
  });
});

describe("schedule read/manage split (H48, H59)", () => {
  it("lets schedule:read see the full schedule without managing it", () => {
    expect(canReadFullSchedule([CAPABILITIES.SCHEDULE_READ])).toBe(true);
    expect(canManageSchedule([CAPABILITIES.SCHEDULE_READ])).toBe(false);
  });

  it("keeps schedule:manage implying read", () => {
    expect(canReadFullSchedule([CAPABILITIES.SCHEDULE_MANAGE])).toBe(true);
    expect(canManageSchedule([CAPABILITIES.SCHEDULE_MANAGE])).toBe(true);
    expect(canReadFullSchedule([CAPABILITIES.ADMIN_ALL])).toBe(true);
  });

  it("denies unrelated capabilities", () => {
    expect(canReadFullSchedule([CAPABILITIES.ACCREDIT_SCAN])).toBe(false);
    expect(canReadFullSchedule([])).toBe(false);
  });

  it("does not add a tab for a read-only holder; the schedule tab is already public", () => {
    expect(visibleTabs([CAPABILITIES.SCHEDULE_READ])).toEqual(visibleTabs([]));
  });
});
