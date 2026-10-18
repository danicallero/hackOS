import { useWindowDimensions } from "react-native";

/**
 * Window size classes, measured on the window the app actually has (a folded
 * cover display, an unfolded inner display, a split-screen half or a floating
 * window) and never on a device model. Same breakpoints as the Android
 * window-size classes: compact < 600dp, medium < 840dp, expanded from 840dp.
 */
export type WindowSizeClass = "compact" | "medium" | "expanded";

export const COMPACT_MAX_WIDTH = 600;
export const MEDIUM_MAX_WIDTH = 840;

/**
 * Widest a screen's content grows. Wider windows (an unfolded foldable, a
 * tablet, a floating window dragged wide) get a centred column instead of
 * stretched phone rows; the floating tab bar sits inside that column too.
 */
export const MAX_CONTENT_WIDTH = 720;

export function windowSizeClass(width: number): WindowSizeClass {
  if (width < COMPACT_MAX_WIDTH) return "compact";
  if (width < MEDIUM_MAX_WIDTH) return "medium";
  return "expanded";
}

/** The width screens lay out in, given the window width. */
export function contentFrameWidth(windowWidth: number): number {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

/** Re-renders when the window resizes: fold, unfold, rotate, split-screen. */
export function useWindowSizeClass(): {
  width: number;
  height: number;
  sizeClass: WindowSizeClass;
} {
  const { width, height } = useWindowDimensions();
  return { width, height, sizeClass: windowSizeClass(width) };
}
