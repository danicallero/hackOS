/**
 * The title every top-level screen shows in the bar row (Activities, Scanner, Schedule, Contacts):
 * one size and weight, so they read the same whichever of them draws it. The native bar's items
 * centre on `SCREEN_TITLE_CENTER` pt from the top of the window; a title drawn by a screen itself
 * (the two-pane Schedule) sits on the same line.
 */
export const SCREEN_TITLE = { fontSize: 28, fontWeight: "800", lineHeight: 34 } as const;
export const SCREEN_TITLE_CENTER = 47.5;

/** Height of each column's own top band in a two-pane layout (Schedule, Gallery). */
export const TWO_PANE_BAND = 72;

/**
 * Height of a two-pane band for a title of `lines` lines at the system `fontScale`: the title's
 * top offset (so it centres on `SCREEN_TITLE_CENTER`), its lines at the scaled line height, and the
 * band's bottom padding. At scale 1 and one line this is exactly `TWO_PANE_BAND`; bigger text grows
 * it, never shrinks it. Bands that sit in the layout flow use `minHeight: TWO_PANE_BAND` and grow on
 * their own; this is for bands drawn over content that must reserve the same space.
 */
export function twoPaneBandHeight(fontScale: number, lines = 1): number {
  const top = SCREEN_TITLE_CENTER - SCREEN_TITLE.lineHeight / 2;
  const bottom = TWO_PANE_BAND - top - SCREEN_TITLE.lineHeight;
  return Math.max(
    TWO_PANE_BAND,
    Math.ceil(top + SCREEN_TITLE.lineHeight * Math.max(1, fontScale) * lines + bottom),
  );
}
