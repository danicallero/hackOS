/**
 * Pure decisions for the Activities list/detail layout (H22, H55, H59): which activity a route
 * parameter names, whether a row is the selected one and how tall the scan result card may be
 * inside the scanner pane. The window shell stays in `lib/window-size.ts`.
 */

/** Overlay padding the result card keeps clear of the pane edges, top and bottom together. */
export const RESULT_CARD_VERTICAL_PADDING = 40;

/** The activity id a route parameter names, or null when it is missing or not a positive integer. */
export function parseActivityId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A row is highlighted only while the scanner pane is beside the list. */
export function isActivitySelected(
  twoPane: boolean,
  selectedId: number | null,
  itemId: number,
): boolean {
  return twoPane && selectedId !== null && selectedId === itemId;
}

/**
 * Tallest the scan result card grows. A full-screen scanner measures the window; the embedded
 * one measures its pane below the title band, so the card never reaches under the list.
 */
export function resultCardMaxHeight(input: {
  windowHeight: number;
  insetsTop: number;
  insetsBottom: number;
  tabBarBottomInset: number;
  /** Measured pane height and the title band above the overlay; null for the full-screen route. */
  pane: { height: number | null; band: number } | null;
}): number {
  const { windowHeight, insetsTop, insetsBottom, tabBarBottomInset, pane } = input;
  if (pane === null) {
    return (
      windowHeight - insetsTop - insetsBottom - tabBarBottomInset - RESULT_CARD_VERTICAL_PADDING
    );
  }
  const height = pane.height ?? windowHeight - insetsTop - insetsBottom;
  return Math.max(0, height - pane.band - tabBarBottomInset - RESULT_CARD_VERTICAL_PADDING);
}
