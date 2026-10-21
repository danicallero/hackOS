import { SCREEN_TITLE_CENTER } from "@/theme/screen-title";

/** Layout of the Scanner's two-pane window (reader left, person right); see `lib/scan-pane.ts`. */

/** Widest the person profile grows in the right pane; wider panes centre it. */
export const SCAN_DETAIL_MAX_WIDTH = 760;

/** Space between the top band and the profile's first row. */
export const SCAN_DETAIL_TOP_GAP = 8;

/** Height of the finder header's touch row (the 44pt back and action buttons). */
export const FINDER_HEADER_ROW_HEIGHT = 44;

/** Padding `LegacyScreenHeader` adds above its row. */
const LEGACY_HEADER_TOP_PADDING = 8;

/**
 * Space above the finder's header so its back button centres on the line the pane's own title sat
 * on (`SCREEN_TITLE_CENTER`), which the finder covers.
 */
export const FINDER_HEADER_TOP =
  SCREEN_TITLE_CENTER - FINDER_HEADER_ROW_HEIGHT / 2 - LEGACY_HEADER_TOP_PADDING;
