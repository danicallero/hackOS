/**
 * Layout of the Activities list/detail window (H22, H55, H59), the same geometry as the Schedule
 * two-pane: the list pane keeps `resolveListPaneWidth`, the scanner pane gets the rest, each draws
 * its own title band, and the bar's trailing buttons keep clear of the scanner band.
 */
import { Platform, useWindowDimensions } from "react-native";
import { useBookCrease } from "@/lib/fold-region";
import { resolveListPaneWidth } from "@/lib/pane-width";
import { listDetailLayout } from "@/lib/window-size";
import { SCREEN_TITLE, SCREEN_TITLE_CENTER, twoPaneBandHeight } from "@/theme/screen-title";

/** Room the native/legacy bar's trailing buttons (filter, search) take over the scanner band. */
export const PANE_TOOLBAR_RESERVE = 136;

/** Leading inset of the scanner pane's title band. */
export const PANE_BAND_INSET = 20;

/** Height of the queue status pill that shares the scanner band. */
export const PANE_CONTROL_HEIGHT = 44;

/** Distance from the top of the pane that centres a control of `PANE_CONTROL_HEIGHT` on the title line. */
export const PANE_CONTROL_TOP = SCREEN_TITLE_CENTER - PANE_CONTROL_HEIGHT / 2;

/** Top padding that centres a title line on `SCREEN_TITLE_CENTER`. */
export const PANE_TITLE_TOP = SCREEN_TITLE_CENTER - SCREEN_TITLE.lineHeight / 2;

export interface ActivityPaneLayout {
  /** The scanner sits beside the list. */
  twoPane: boolean;
  listWidth: number;
  /** Crease the scanner pane keeps clear of on a book-pose foldable. */
  gutter: number;
  /** Height of the scanner pane's title band at the current text size. */
  band: number;
}

/** Re-renders on resize, fold, rotation and Dynamic Type; Schedule uses the same helpers. */
export function useActivityPaneLayout(): ActivityPaneLayout {
  const { width, height, fontScale } = useWindowDimensions();
  const crease = useBookCrease();
  const layout = listDetailLayout(width, height, Platform.OS, crease);
  return {
    twoPane: layout.enabled,
    listWidth: resolveListPaneWidth(width, layout, crease),
    gutter: layout.gutter,
    band: twoPaneBandHeight(fontScale),
  };
}
