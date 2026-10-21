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
 * Every non-class breakpoint lives here, next to the classes it refines. Each is an
 * intentional exception to 600/840 because a layout already verified on a device depends on it.
 *
 * Tablet tab bar geometry (thinner bar, six direct cells). Not 600: the portrait Fold inner
 * display (~673pt, medium) keeps the phone geometry; iPad portrait (744pt and up) gets the
 * tablet one.
 */
export const TABLET_TAB_BAR_MIN_WIDTH = 700;

/**
 * A tablet window with room for a labelled rail, a list and a detail (iPad landscape,
 * 1180x820 and up). Not the expanded class (840): an iPhone Duo book (951x669) and a short
 * expanded window are expanded but keep the narrow 64pt rail.
 */
export const TABLET_LANDSCAPE_MIN_WIDTH = 1100;
export const TABLET_LANDSCAPE_MIN_HEIGHT = 800;

/**
 * Android opens the list beside the detail from this window on, in portrait too. Not the
 * expanded class (840): the Fold inner display in portrait (673x841) is medium and verified
 * with two panes. iOS keeps the expanded class.
 */
export const ANDROID_LIST_DETAIL_MIN_WIDTH = 640;
export const ANDROID_LIST_DETAIL_MIN_HEIGHT = 600;

/** List pane widths of the list/detail layout. */
export const LIST_PANE_WIDTH = { tablet: 420, androidMedium: 340, default: 380 } as const;

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
  return (
    width >= TABLET_LANDSCAPE_MIN_WIDTH && height >= TABLET_LANDSCAPE_MIN_HEIGHT && width > height
  );
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

/** Narrowest a page either side of a vertical crease may be and still hold a list or a detail. */
export const MIN_PAGE_WIDTH = 280;

/**
 * H55: opened Android windows fit a narrower list beside their detail, even in portrait. On a
 * foldable iPhone half open like a book, the crease is the divider: the list fills the page before
 * it, the detail the page after it, and `gutter` is the crease the detail keeps clear.
 */
export function listDetailLayout(
  width: number,
  height: number,
  platform: string,
  crease: { x: number; width: number } | null = null,
) {
  const enabled =
    platform === "android"
      ? width >= ANDROID_LIST_DETAIL_MIN_WIDTH && height >= ANDROID_LIST_DETAIL_MIN_HEIGHT
      : windowSizeClass(width) === "expanded";
  const pagesFit =
    crease !== null &&
    crease.x >= MIN_PAGE_WIDTH &&
    width - crease.x - crease.width >= MIN_PAGE_WIDTH;
  return {
    enabled,
    gutter: enabled && pagesFit ? Math.round(crease.width) : 0,
    listWidth:
      enabled && pagesFit
        ? Math.round(crease.x)
        : isTabletLandscapeWindow(width, height)
          ? LIST_PANE_WIDTH.tablet
          : platform === "android" && width < MEDIUM_MAX_WIDTH
            ? LIST_PANE_WIDTH.androidMedium
            : LIST_PANE_WIDTH.default,
  };
}
