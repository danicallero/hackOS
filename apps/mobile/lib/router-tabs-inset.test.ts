import {
  routerTabBarDirectTabsForWidth,
  routerTabBarHeightForWidth,
  routerTabBarInsets,
  routerTabBarMaxTabsWithoutOverflowForWidth,
  routerTabBarScrollBottomInset,
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
});
