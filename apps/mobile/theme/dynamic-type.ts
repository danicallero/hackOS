/**
 * Dynamic Type cap for fixed-size chrome only: the tab bar, React Native
 * titles inside native navigation-bar items (UIKit hides an item that outgrows
 * the bar) and overlays on the live camera, which cannot grow without covering
 * the screen they frame.
 * Content text is never capped — it wraps and its container grows.
 *
 * The cap is iOS's largest standard size (xxxLarge, the 1.353 multiplier React
 * Native reports for it). Capped labels also shrink to fit their slot rather
 * than truncate, as UIKit tab bars do.
 */
export const CHROME_MAX_FONT_SIZE_MULTIPLIER = 1.353;

/** Smallest shrink-to-fit factor for a capped chrome label. */
export const CHROME_MIN_FONT_SCALE = 0.7;

/**
 * Whether the system text size is one of the accessibility sizes (AX1–AX5 on
 * iOS), i.e. larger than the chrome cap. Side-by-side label/value layouts
 * stack at these sizes.
 */
export function isAccessibilityTextSize(fontScale: number): boolean {
  return fontScale > CHROME_MAX_FONT_SIZE_MULTIPLIER;
}
