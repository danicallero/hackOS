/**
 * The title every top-level screen shows in the bar row (Activities, Scanner, Schedule, Contacts):
 * one size and weight, so they read the same whichever of them draws it. The native bar's items
 * centre on `SCREEN_TITLE_CENTER` pt from the top of the window; a title drawn by a screen itself
 * (the two-pane Schedule) sits on the same line.
 */
export const SCREEN_TITLE = { fontSize: 28, fontWeight: "800", lineHeight: 34 } as const;
export const SCREEN_TITLE_CENTER = 43;
