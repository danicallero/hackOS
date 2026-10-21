/**
 * Non-colour design tokens (H55, H59). Colours live in `theme/colors.ts`,
 * Dynamic Type caps in `theme/dynamic-type.ts`. `docs/DESIGN.md` §12 explains
 * how the three fit together; screens import from `@/theme`.
 */
import type { TextStyle } from "react-native";

/** 4-pt grid with the two half-steps UIKit rows use (6, 10). */
export const space = {
  hair: 2,
  xxs: 4,
  xs: 6,
  sm: 8,
  row: 10,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/**
 * One radius per role: `control` for buttons and fields, `container` for
 * inset-grouped sections and cards, `sheet` for large floating surfaces,
 * `full` for capsules. Always paired with `borderCurve: "continuous"`.
 */
export const radius = {
  chip: 10,
  control: 12,
  container: 14,
  sheet: 22,
  full: 999,
} as const;

/**
 * Apple's text styles. `compact` (14) is the app's one off-ramp step for
 * dense secondary lines. Weight is part of the style so a role never drifts.
 */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", lineHeight: 41 },
  title: { fontSize: 28, fontWeight: "700", lineHeight: 34 },
  title2: { fontSize: 22, fontWeight: "700", lineHeight: 28 },
  title3: { fontSize: 20, fontWeight: "600", lineHeight: 25 },
  headline: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  body: { fontSize: 17, fontWeight: "400", lineHeight: 22 },
  callout: { fontSize: 16, fontWeight: "400", lineHeight: 21 },
  subhead: { fontSize: 15, fontWeight: "400", lineHeight: 20 },
  compact: { fontSize: 14, fontWeight: "400", lineHeight: 19 },
  footnote: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Durations (ms) and springs shared by every animation so motion feels related. */
export const motion = {
  duration: { fast: 150, base: 250, slow: 400 },
  /** Interruptible spring for press, toggle and small layout changes. */
  spring: { damping: 20, stiffness: 320, mass: 0.8 },
  /** Larger surfaces: sheets, banners, expanding sections. */
  springSoft: { damping: 22, stiffness: 220, mass: 1 },
} as const;

/** Pressed-state feedback, identical on iOS and Android (no Material ripple). */
export const pressed = {
  /** Text-only and icon controls fade. */
  opacity: 0.6,
  /** Filled controls shrink slightly and dim. */
  scale: 0.96,
  filledOpacity: 0.9,
  /** Disabled controls. */
  disabledOpacity: 0.45,
} as const;

/** Pointer and keyboard feedback (iPad trackpad, Mac, Android mouse, hardware keyboards). */
export const pointer = {
  /** Text and icon controls dim slightly under the cursor (pressed is 0.6). */
  hoverOpacity: 0.8,
  /** Filled controls and cards under the cursor. */
  hoverFilledOpacity: 0.94,
  /** Keyboard focus ring, drawn in `colors.accent`. */
  focusRingWidth: 2,
  focusRingOffset: 2,
} as const;

/** Minimum touch target (Apple HIG 44 pt; Android 48 dp is covered by hitSlop). */
export const MIN_TARGET = 44;
