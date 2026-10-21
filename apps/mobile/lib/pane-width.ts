/**
 * Pure sizing rules for participant surfaces (H55, H59): how wide a list pane is, how many
 * tiles fit a row and when a card's text is too narrow to share a line with a badge. They take
 * measured widths only, never a device model, so a folded cover, a Stage Manager window and a
 * resized Mac window resolve the same way. The window shell owns `lib/window-size.ts`; this file
 * only refines the list width it returns.
 */

/** A list pane is a share of the window, kept between a floor that fits a card and a ceiling. */
export const LIST_PANE = { min: 340, share: 0.38, max: 460 } as const;

/** The narrowest a detail pane beside the list may become before the list gives way. */
export const DETAIL_PANE_MIN_WIDTH = 320;

/** The narrowest a list pane may ever become, however small the window. */
export const LIST_PANE_FLOOR = 280;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `clamp(340, 38% of the window, 460)`, never leaving the detail pane under its minimum. */
export function listPaneWidth(windowWidth: number, creaseGutter = 0): number {
  const wanted = clamp(Math.round(windowWidth * LIST_PANE.share), LIST_PANE.min, LIST_PANE.max);
  const room = windowWidth - creaseGutter - DETAIL_PANE_MIN_WIDTH;
  return Math.round(Math.max(LIST_PANE_FLOOR, Math.min(wanted, room)));
}

/**
 * The list width for a two-pane window. A foldable held like a book keeps the page before the
 * crease (the verified geometry); every other window uses the share rule.
 */
export function resolveListPaneWidth(
  windowWidth: number,
  layout: { listWidth: number; gutter: number },
  crease: { x: number } | null,
): number {
  if (crease !== null && layout.gutter > 0 && layout.listWidth === Math.round(crease.x)) {
    return layout.listWidth;
  }
  return listPaneWidth(windowWidth);
}

/** Columns of tiles at least `minTileWidth` wide that fit `availableWidth`, between 1 and `max`. */
export function columnCount(
  availableWidth: number,
  minTileWidth: number,
  gap: number,
  max = Number.POSITIVE_INFINITY,
): number {
  if (availableWidth <= 0 || minTileWidth <= 0) return 1;
  const fit = Math.floor((availableWidth + gap) / (minTileWidth + gap));
  return clamp(fit, 1, Math.max(1, max));
}

/** Width of one tile in a row of `columns` filling `availableWidth`. */
export function tileWidth(availableWidth: number, columns: number, gap: number): number {
  return Math.floor((availableWidth - gap * (columns - 1)) / columns);
}

/** Below this much room a title and its badge would wrap per syllable, so the badge drops below. */
export const MIN_INLINE_BADGE_TEXT_WIDTH = 220;

/** Whether a badge shares the title's line (`textWidth` is what the title would get beside it). */
export function badgeFitsBesideTitle(textWidth: number, stackedText: boolean): boolean {
  return !stackedText && textWidth >= MIN_INLINE_BADGE_TEXT_WIDTH;
}

/** Widest a form or single-column settings page grows; wider windows centre it. */
export const FORM_MAX_WIDTH = 560;
