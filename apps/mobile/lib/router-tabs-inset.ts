import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Visual height occupied by the floating tab bar, including its safe-area gap. */
export const ROUTER_TAB_BAR_HEIGHT = 64;
export const ROUTER_TAB_BAR_VERTICAL_PADDING = 8;
const ROUTER_TAB_BAR_TABLET_HEIGHT = 56;
const ROUTER_TAB_BAR_TABLET_VERTICAL_PADDING = 6;
const ROUTER_TAB_BAR_TABLET_BREAKPOINT = 700;
const ROUTER_TAB_BAR_TABLET_DIRECT_TABS = 6;

export interface RouterTabBarInsets {
  /** The platform's bottom safe-area inset (home indicator/navigation bar). */
  safeAreaBottom: number;
  /** Space between the bottom of the screen and the tab surface. */
  tabBarBottomPadding: number;
  /** Height of the tab surface itself. */
  tabBarHeight: number;
  /** Vertical padding inside the bar's outer safe-area wrapper. */
  tabBarVerticalPadding: number;
  /** Bottom padding required for content to finish above the floating tab bar. */
  contentBottomInset: number;
}

export function routerTabBarBottomPadding(safeAreaBottom: number): number {
  return Math.max(12, safeAreaBottom - 16);
}

export function routerTabBarHeightForWidth(width: number): number {
  return width >= ROUTER_TAB_BAR_TABLET_BREAKPOINT
    ? ROUTER_TAB_BAR_TABLET_HEIGHT
    : ROUTER_TAB_BAR_HEIGHT;
}

export function routerTabBarVerticalPaddingForWidth(width: number): number {
  return width >= ROUTER_TAB_BAR_TABLET_BREAKPOINT
    ? ROUTER_TAB_BAR_TABLET_VERTICAL_PADDING
    : ROUTER_TAB_BAR_VERTICAL_PADDING;
}

/** Number of direct cells available before an overflow circle is needed. */
export function routerTabBarDirectTabsForWidth(width: number): number {
  return width >= ROUTER_TAB_BAR_TABLET_BREAKPOINT ? ROUTER_TAB_BAR_TABLET_DIRECT_TABS : 4;
}

/** Direct-cell budget when no overflow circle is rendered. */
export function routerTabBarMaxTabsWithoutOverflowForWidth(width: number): number {
  return width >= ROUTER_TAB_BAR_TABLET_BREAKPOINT ? ROUTER_TAB_BAR_TABLET_DIRECT_TABS : 5;
}

export function routerTabBarInsets(safeAreaBottom: number, width = 0): RouterTabBarInsets {
  const tabBarBottomPadding = routerTabBarBottomPadding(safeAreaBottom);
  const tabBarHeight = routerTabBarHeightForWidth(width);
  return {
    safeAreaBottom,
    tabBarBottomPadding,
    tabBarHeight,
    tabBarVerticalPadding: routerTabBarVerticalPaddingForWidth(width),
    contentBottomInset:
      tabBarHeight + routerTabBarVerticalPaddingForWidth(width) + tabBarBottomPadding,
  };
}

export function routerTabBarBottomInset(safeAreaBottom: number, width = 0): number {
  return routerTabBarInsets(safeAreaBottom, width).contentBottomInset;
}

const RouterTabBarInsetsContext = createContext<RouterTabBarInsets | null>(null);

/** Provides the custom tab bar's geometry to every route rendered in its TabSlot. */
export function RouterTabBarInsetsProvider({ children }: { children: ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const insets = useMemo(() => routerTabBarInsets(bottom, width), [bottom, width]);
  return createElement(RouterTabBarInsetsContext.Provider, { value: insets }, children);
}

/**
 * Geometry published by the nearest custom tab bar. This is intentionally a
 * hook rather than a screen-specific constant so consumers stay correct when
 * the device safe area changes (rotation, Dynamic Island, keyboard, etc.).
 */
export function useRouterTabBarInsets(): RouterTabBarInsets {
  const context = useContext(RouterTabBarInsetsContext);
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return context ?? routerTabBarInsets(bottom, width);
}

/** Bottom content clearance needed for a scroll view beneath the custom bar. */
export function useRouterTabBarBottomInset(): number {
  return useRouterTabBarInsets().contentBottomInset;
}

/**
 * Bottom padding for scroll views that still use iOS's automatic inset
 * adjustment. UIKit already contributes the device bottom safe area there;
 * subtract it once so the custom tab bar does not create a second blank band.
 * Android ignores `contentInsetAdjustmentBehavior`, so it keeps the complete
 * custom-bar clearance.
 */
export function useRouterTabBarScrollBottomInset(): number {
  return routerTabBarScrollBottomInset(useRouterTabBarInsets(), Platform.OS);
}

export function routerTabBarScrollBottomInset(
  insets: Pick<RouterTabBarInsets, "contentBottomInset" | "safeAreaBottom">,
  platform: string,
): number {
  return Math.max(0, insets.contentBottomInset - (platform === "ios" ? insets.safeAreaBottom : 0));
}
