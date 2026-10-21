/**
 * Size-class aware layout tokens (H55, H59). Everything keys off the window the app
 * actually has (see `lib/window-size.ts`), never a device model or `Platform`, so a
 * folded cover, a split-screen half, an iPad window and a resized Mac window all
 * resolve the same way. `docs/DESIGN.md` §12 explains how they fit the other tokens.
 */
import {
  maxContentWidth,
  useWindowSizeClass,
  type WindowSizeClass,
  windowSizeClass,
} from "@/lib/window-size";

/** One value per size class; a missing class falls back to the next smaller one. */
export interface SizeClassValues<T> {
  compact: T;
  medium?: T;
  expanded?: T;
}

export function sizeClassValue<T>(sizeClass: WindowSizeClass, values: SizeClassValues<T>): T {
  if (sizeClass === "expanded") return values.expanded ?? values.medium ?? values.compact;
  if (sizeClass === "medium") return values.medium ?? values.compact;
  return values.compact;
}

/** The value for the current window's size class; re-renders on fold, rotate and resize. */
export function useSizeClassValue<T>(values: SizeClassValues<T>): T {
  return sizeClassValue(useWindowSizeClass().sizeClass, values);
}

/** Horizontal screen gutter per size class, inside the safe area. */
export const SCREEN_GUTTER = { compact: 16, medium: 24, expanded: 32 } as const;

export function screenGutter(windowWidth: number): number {
  return sizeClassValue(windowSizeClass(windowWidth), SCREEN_GUTTER);
}

export function useScreenGutter(): number {
  return useSizeClassValue(SCREEN_GUTTER);
}

/**
 * The widest a reading pane (a list, a form, a sheet) grows. This is a limit on content
 * panes only: the navigator itself uses the whole window on large tablets (R028).
 */
export const readableContentWidth = maxContentWidth;

export { TABLET_TAB_BAR_MIN_WIDTH } from "@/lib/window-size";
