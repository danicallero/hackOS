import {
  routerTabBarDirectTabsForWidth,
  routerTabBarHeightForWidth,
  routerTabBarInsets,
  routerTabBarMaxTabsWithoutOverflowForWidth,
  routerTabBarScrollBottomInset,
  routerTabBarVerticalBudget,
  routerTabBarVerticalPaddingForWidth,
} from "./router-tabs-inset";

describe("router tab bar geometry", () => {
  it("keeps compact devices on the four-tab, 64pt geometry", () => {
    expect(routerTabBarDirectTabsForWidth(390)).toBe(4);
    expect(routerTabBarMaxTabsWithoutOverflowForWidth(390)).toBe(5);
    expect(routerTabBarHeightForWidth(390)).toBe(64);
    expect(routerTabBarVerticalPaddingForWidth(390)).toBe(8);
    expect(routerTabBarInsets(34, 390)).toMatchObject({
      contentBottomInset: 90,
      tabBarBottomPadding: 18,
      tabBarHeight: 64,
      tabBarVerticalPadding: 8,
    });
  });

  it("uses the thinner, wider tablet geometry", () => {
    expect(routerTabBarDirectTabsForWidth(834)).toBe(6);
    expect(routerTabBarMaxTabsWithoutOverflowForWidth(834)).toBe(6);
    expect(routerTabBarHeightForWidth(834)).toBe(56);
    expect(routerTabBarVerticalPaddingForWidth(834)).toBe(6);
    expect(routerTabBarInsets(20, 834)).toMatchObject({
      contentBottomInset: 74,
      tabBarBottomPadding: 12,
      tabBarHeight: 56,
      tabBarVerticalPadding: 6,
    });
  });

  it("does not double-count the iOS safe area with automatic scroll adjustment", () => {
    const insets = routerTabBarInsets(34, 390);

    expect(routerTabBarScrollBottomInset(insets, "ios")).toBe(56);
    expect(routerTabBarScrollBottomInset(insets, "android")).toBe(90);
  });

  it("keeps six tablet destinations in the landscape rail when height permits", () => {
    expect(routerTabBarVerticalBudget(1032, 12, 1366)).toEqual({ direct: 6, withoutOverflow: 6 });
    expect(routerTabBarVerticalBudget(390, 12, 844)).toEqual({ direct: 3, withoutOverflow: 4 });
    expect(routerTabBarInsets(20, 1366, true).contentBottomInset).toBe(20);
  });
});

describe("tablet breakpoint", () => {
  it("switches geometry at the shared tablet tab-bar width", () => {
    expect(routerTabBarHeightForWidth(699)).toBe(64);
    expect(routerTabBarHeightForWidth(700)).toBe(56);
  });
});

describe("tablet rail budget", () => {
  it("lists every destination up to the height, not the width cap (H55)", () => {
    const rail = routerTabBarVerticalBudget(1024, 20, 1180, true);
    const bar = routerTabBarVerticalBudget(1024, 20, 1180);
    expect(rail.direct).toBe(rail.withoutOverflow);
    expect(rail.withoutOverflow).toBeGreaterThan(bar.withoutOverflow);
    expect(rail.withoutOverflow).toBeGreaterThanOrEqual(8);
  });
});
