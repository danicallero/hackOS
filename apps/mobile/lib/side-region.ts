import { createContext, createElement, type ReactNode, useContext } from "react";
import {
  isCompactPassportWindow,
  isTabletLandscapeWindow,
  listDetailLayout,
} from "@/lib/window-size";

/**
 * On a foldable iPhone the system moves its bars and indicators to one side:
 * the outer display always, the inner display in landscape. That shows up as a
 * large, asymmetric horizontal safe-area inset. A side region of at least this
 * size is where our own bars belong (the system only moves bars it owns); the
 * inner display in portrait has no such inset and keeps its horizontal bars.
 */
export const SIDE_REGION_MIN_SIZE = 56;

export interface SideRegion {
  /** The edge the system reserves, or null when every bar stays horizontal. */
  edge: "left" | "right" | null;
  /** Width of the reserved column (0 without one). */
  size: number;
  /** The wide labelled tablet rail rather than a symbol-only column. */
  tabletRail?: boolean;
}

export const NO_SIDE_REGION: SideRegion = { edge: null, size: 0 };

/** Width given to the system's column where the insets do not report it (Split View). */
export const RESERVED_COLUMN_SIZE = 64;
export const TABLET_NAVIGATION_WIDTH = 200;
/**
 * Column Android reserves for the symbol-only bar (no reserved-region API there): the bar's
 * right edge is 20pt (system column line) - 4pt rim + 52pt pill = 68pt, plus an 8pt gap.
 * iOS keeps `RESERVED_COLUMN_SIZE`, where the system's own column sets the line.
 */
export const ANDROID_RAIL_COLUMN_SIZE = 76;

/** True when the window gets the labelled tablet rail (iOS, no system column, wide landscape). */
export function isTabletRailWindow(
  insets: { left: number; right: number },
  systemEdge: "left" | "right" | null,
  window: { width: number; height: number },
  platform: string,
): boolean {
  return (
    platform === "ios" &&
    !sideRegionForInsets(effectiveSideInsets(insets, systemEdge)).edge &&
    window.width > window.height &&
    window.height >= 600 &&
    isTabletLandscapeWindow(window.width, window.height)
  );
}

/** H55: wide iPad windows share the side navigation used by foldable windows. */
export function navigationSideInsets(
  insets: { left: number; right: number },
  systemEdge: "left" | "right" | null,
  window: { width: number; height: number },
  platform: string,
): { left: number; right: number } {
  // A system-owned column always wins, including a foldable's right-hand column.
  const reserved = effectiveSideInsets(insets, systemEdge);
  if (sideRegionForInsets(reserved).edge) return reserved;
  if (
    platform === "android" &&
    (isCompactPassportWindow(window.width, window.height) ||
      listDetailLayout(window.width, window.height, platform).enabled)
  ) {
    return { left: reserved.left + ANDROID_RAIL_COLUMN_SIZE, right: reserved.right };
  }
  if (platform === "ios" && window.width > window.height && window.height >= 600) {
    return {
      left: isTabletRailWindow(insets, systemEdge, window, platform)
        ? TABLET_NAVIGATION_WIDTH
        : RESERVED_COLUMN_SIZE,
      right: reserved.right,
    };
  }
  return reserved;
}

/**
 * The horizontal insets with the system's vertical-bar column folded in. In Split View the
 * left app's column sits on its outer edge but the safe-area insets stay 0, so the edge the
 * system reports through `UITraitCollection.verticalBarEdge` supplies the column instead.
 */
export function effectiveSideInsets(
  insets: { left: number; right: number },
  barEdge: "left" | "right" | null,
): { left: number; right: number } {
  if (barEdge === "left" && insets.left < SIDE_REGION_MIN_SIZE) {
    return { left: RESERVED_COLUMN_SIZE, right: insets.right };
  }
  if (barEdge === "right" && insets.right < SIDE_REGION_MIN_SIZE) {
    return { left: insets.left, right: RESERVED_COLUMN_SIZE };
  }
  return insets;
}

export function sideRegionForInsets(insets: { left: number; right: number }): SideRegion {
  const size = Math.max(insets.left, insets.right);
  if (size < SIDE_REGION_MIN_SIZE) return NO_SIDE_REGION;
  return { edge: insets.right >= insets.left ? "right" : "left", size };
}

const SideRegionContext = createContext<SideRegion>(NO_SIDE_REGION);

export function SideRegionProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SideRegion;
}) {
  return createElement(SideRegionContext.Provider, { value }, children);
}

/** The reserved side column the navigator was laid out beside, if any. */
export function useSideRegion(): SideRegion {
  return useContext(SideRegionContext);
}
