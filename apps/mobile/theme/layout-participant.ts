/**
 * Layout for participant surfaces (H55, H59): symmetric size-class gutters and a readable,
 * centred content column, so header and body share one leading edge at every window size.
 * Navigators stay full width; only content panes are bounded (R028).
 */
import { useWindowDimensions } from "react-native";
import { columnCount, FORM_MAX_WIDTH, tileWidth } from "@/lib/pane-width";
import { windowSizeClass } from "@/lib/window-size";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { readableContentWidth, screenGutter } from "@/theme/layout";

export type ContentKind = "form" | "list" | "grid";

/** Style for a ScrollView/FlatList `contentContainerStyle`: centred, bounded (full width when expanded), equal gutters. */
export interface ReadableContentStyle {
  alignSelf: "center" | "flex-start";
  maxWidth: number;
  paddingHorizontal: number;
  width: "100%";
}

export interface ParticipantLayout {
  /** Gutter either side of the content. */
  gutter: number;
  /** Width the content column occupies, gutters included. */
  columnWidth: number;
  /** Width available to content inside the gutters. */
  innerWidth: number;
  /** System text size is an accessibility size: side-by-side rows should stack. */
  stacked: boolean;
  /** Spread into `contentContainerStyle`. */
  content: ReadableContentStyle;
  /** Columns of tiles at least `minTile` wide that fit the column. */
  columns: (minTile: number, gap: number, max?: number) => number;
  /** Width of one tile in a row of `columns`. */
  tile: (columns: number, gap: number) => number;
}

export function participantLayout(
  windowWidth: number,
  fontScale: number,
  kind: ContentKind,
): ParticipantLayout {
  const gutter = screenGutter(windowWidth);
  // Forms are narrowest; lists and grids use the whole window once it is expanded (a tablet or
  // Mac window should not leave a third of the screen empty), the readable width before.
  const cap =
    kind === "form"
      ? FORM_MAX_WIDTH + gutter * 2
      : windowSizeClass(windowWidth) === "expanded"
        ? windowWidth
        : readableContentWidth(windowWidth);
  const columnWidth = Math.min(windowWidth, cap);
  // A narrow form centred in an expanded window leaves the native title at the window edge and
  // the body in the middle of an empty canvas. There it starts at the leading edge, under the title.
  const alignSelf =
    kind === "form" && windowSizeClass(windowWidth) === "expanded" ? "flex-start" : "center";
  const innerWidth = columnWidth - gutter * 2;
  return {
    columnWidth,
    columns: (minTile, gap, max) => columnCount(innerWidth, minTile, gap, max),
    content: { alignSelf, maxWidth: cap, paddingHorizontal: gutter, width: "100%" },
    gutter,
    innerWidth,
    stacked: isAccessibilityTextSize(fontScale),
    tile: (columns, gap) => tileWidth(innerWidth, columns, gap),
  };
}

/** The participant layout for the current window; re-renders on fold, rotate and resize. */
export function useParticipantLayout(kind: ContentKind = "list"): ParticipantLayout {
  const { width, fontScale } = useWindowDimensions();
  return participantLayout(width, fontScale, kind);
}
