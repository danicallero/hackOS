import { useWindowDimensions } from "react-native";
import { SQUARISH_MAX_ASPECT } from "@/lib/screen-orientation";

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

/**
 * An expanded window (an unfolded inner display in landscape, a tablet) is regular
 * in both dimensions: it uses most of its width instead of leaving it empty, up to
 * this bound.
 */
export const EXPANDED_MAX_CONTENT_WIDTH = 960;

/** The widest a screen's content grows in a window of this width. */
export function maxContentWidth(windowWidth: number): number {
  return windowSizeClass(windowWidth) === "expanded"
    ? EXPANDED_MAX_CONTENT_WIDTH
    : MAX_CONTENT_WIDTH;
}

/** H55: enough room for navigation, a readable list and a separate detail pane. */
export function isTabletLandscapeWindow(width: number, height: number): boolean {
  return width >= 1100 && height >= 800 && width > height;
}

export function windowSizeClass(width: number): WindowSizeClass {
  if (width < COMPACT_MAX_WIDTH) return "compact";
  if (width < MEDIUM_MAX_WIDTH) return "medium";
  return "expanded";
}

/** The width screens lay out in, given the window width. */
export function contentFrameWidth(windowWidth: number): number {
  return Math.min(windowWidth, maxContentWidth(windowWidth));
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

/** H55: compact passport covers use the same navigation shape as Duo's cover. */
export function isCompactPassportWindow(width: number, height: number): boolean {
  const short = Math.min(width, height);
  return (
    short >= 320 &&
    short < 600 &&
    height >= 400 &&
    Math.max(width, height) < short * SQUARISH_MAX_ASPECT
  );
}

/** H55: opened Android windows fit a narrower list beside their detail, even in portrait. */
export function listDetailLayout(width: number, height: number, platform: string) {
  return {
    enabled:
      platform === "android"
        ? width >= 640 && height >= 600
        : windowSizeClass(width) === "expanded",
    listWidth: isTabletLandscapeWindow(width, height)
      ? 420
      : platform === "android" && width < 840
        ? 300
        : 380,
  };
}
