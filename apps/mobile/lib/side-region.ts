import { createContext, createElement, type ReactNode, useContext } from "react";

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
}

export const NO_SIDE_REGION: SideRegion = { edge: null, size: 0 };

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
