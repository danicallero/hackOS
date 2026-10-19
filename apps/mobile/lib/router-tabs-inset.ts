import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSideRegion } from "@/lib/side-region";

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
  /** The bar stands in the side column the system reserves, not along the bottom. */
  vertical: boolean;
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

/** Cell side and gap of the vertical bar, and the space its column leaves to the system indicators. */
export const ROUTER_TAB_BAR_VERTICAL_CELL = 44;
const ROUTER_TAB_BAR_VERTICAL_GAP = 8;
const ROUTER_TAB_BAR_VERTICAL_TOP_RESERVE = 176;

/**
 * How many direct cells the vertical bar can hold in the height the window has,
 * below the system status indicators, with and without an overflow circle.
 */
export function routerTabBarVerticalBudget(
  windowHeight: number,
  bottomPadding: number,
): { direct: number; withoutOverflow: number } {
  const room =
    windowHeight -
    ROUTER_TAB_BAR_VERTICAL_TOP_RESERVE -
    bottomPadding -
    ROUTER_TAB_BAR_VERTICAL_GAP;
  const cells = Math.floor(room / (ROUTER_TAB_BAR_VERTICAL_CELL + 4));
  return {
    direct: Math.min(4, Math.max(2, cells - 1)),
    withoutOverflow: Math.min(5, Math.max(2, cells)),
  };
}

export function routerTabBarInsets(
  safeAreaBottom: number,
  width = 0,
  vertical = false,
): RouterTabBarInsets {
  const tabBarBottomPadding = routerTabBarBottomPadding(safeAreaBottom);
  const tabBarHeight = routerTabBarHeightForWidth(width);
  return {
    safeAreaBottom,
    tabBarBottomPadding,
    tabBarHeight,
    tabBarVerticalPadding: routerTabBarVerticalPaddingForWidth(width),
    // Nothing floats along the bottom of a vertical layout: content only clears the safe area.
    contentBottomInset: vertical
      ? safeAreaBottom
      : tabBarHeight + routerTabBarVerticalPaddingForWidth(width) + tabBarBottomPadding,
    vertical,
  };
}

const RouterTabBarInsetsContext = createContext<RouterTabBarInsets | null>(null);

/** Provides the custom tab bar's geometry to every route rendered in its TabSlot. */
export function RouterTabBarInsetsProvider({ children }: { children: ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const vertical = useSideRegion().edge !== null;
  const insets = useMemo(
    () => routerTabBarInsets(bottom, width, vertical),
    [bottom, width, vertical],
  );
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
  const vertical = useSideRegion().edge !== null;
  return context ?? routerTabBarInsets(bottom, width, vertical);
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
