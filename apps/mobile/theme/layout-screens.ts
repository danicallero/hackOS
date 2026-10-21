/**
 * Layout decisions for the operator surfaces (scanners and their stat blocks, H22-H26, H55, H59).
 * Pure functions keyed on the window the app actually has (a Stage Manager window, a Split View
 * half, a resized Mac window, a fold, a landscape phone) and on the width of the column the
 * content really got, never on a device model. `docs/DESIGN.md` §12 covers the shared tokens.
 */
import { useWindowDimensions } from "react-native";
import { windowSizeClass } from "@/lib/window-size";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { readableContentWidth, screenGutter } from "@/theme/layout";

/** Widest the scanner body column grows per size class; wider windows centre the column. */
export const OPERATOR_COLUMN_MAX = { compact: 440, medium: 520, expanded: 720 } as const;

/** The column holds the stat block on one row from this width (primary + two equal columns). */
export const STAT_ROW_MIN_WIDTH = 440;

/** Three labelled actions sit side by side from this column width (three 220pt buttons + gaps), so "Enter code manually" never wraps. */
export const ACTION_ROW_MIN_WIDTH = 680;

/** Below this window height the reader surface shrinks and the whole body scrolls. */
export const OPERATOR_SHORT_HEIGHT = 520;

export const READER_SYMBOL_SIZE = { regular: 80, short: 56 } as const;

export type StatBlockLayout = "row" | "stacked" | "list";
export type ActionLayout = "row" | "column";

export interface OperatorLayoutInput {
  windowWidth: number;
  windowHeight: number;
  fontScale: number;
  /** Measured width of the bounded column; null before the first layout pass. */
  columnWidth: number | null;
}

export interface OperatorLayout {
  /** Symmetric horizontal gutter, the same on both edges. */
  gutter: number;
  columnMaxWidth: number;
  /** One row of equal columns, the primary count above a row, or every count on its own line. */
  stats: StatBlockLayout;
  actions: ActionLayout;
  shortWindow: boolean;
  symbolSize: number;
}

export function operatorColumnMaxWidth(windowWidth: number): number {
  const sizeClass = windowSizeClass(windowWidth);
  return sizeClass === "expanded"
    ? OPERATOR_COLUMN_MAX.expanded
    : sizeClass === "medium"
      ? OPERATOR_COLUMN_MAX.medium
      : OPERATOR_COLUMN_MAX.compact;
}

export function operatorLayout(input: OperatorLayoutInput): OperatorLayout {
  const { windowWidth, windowHeight, fontScale } = input;
  const accessibility = isAccessibilityTextSize(fontScale);
  const columnMaxWidth = operatorColumnMaxWidth(windowWidth);
  const gutter = screenGutter(windowWidth);
  const inner = input.columnWidth ?? Math.min(windowWidth - 2 * gutter, columnMaxWidth);
  const shortWindow = windowHeight < OPERATOR_SHORT_HEIGHT;
  return {
    gutter,
    columnMaxWidth,
    stats: accessibility ? "list" : inner >= STAT_ROW_MIN_WIDTH ? "row" : "stacked",
    actions: !accessibility && inner >= ACTION_ROW_MIN_WIDTH ? "row" : "column",
    shortWindow,
    symbolSize: shortWindow ? READER_SYMBOL_SIZE.short : READER_SYMBOL_SIZE.regular,
  };
}

/** Re-renders on resize, rotate and Dynamic Type; keeps the tree identical across layouts. */
export function useOperatorLayout(columnWidth: number | null): OperatorLayout {
  const { width, height, fontScale } = useWindowDimensions();
  return operatorLayout({
    windowWidth: width,
    windowHeight: height,
    fontScale,
    columnWidth,
  });
}

/** Smallest and largest side of the square the camera preview scans inside. */
export const SCAN_FRAME = { min: 160, phone: 264, large: 320 } as const;

/**
 * The scan square for a camera viewport: the phone size while it fits, smaller (never under
 * `min`) in a short or narrow window, a little larger once the viewport is a tablet's.
 */
export function scanFrameSize(viewportWidth: number, viewportHeight: number): number {
  if (viewportWidth <= 0 || viewportHeight <= 0) return SCAN_FRAME.phone;
  const short = Math.min(viewportWidth, viewportHeight);
  const cap = short < 600 ? SCAN_FRAME.phone : SCAN_FRAME.large;
  return Math.round(Math.max(SCAN_FRAME.min, Math.min(cap, short * 0.7)));
}

export interface ListColumnStyle {
  alignSelf: "center";
  maxWidth: number;
  paddingHorizontal: number;
  width: "100%";
}

/**
 * Content-container style for an operator list or form: the same gutter on both edges and a
 * reading column that stays centred; expanded windows use their full width.
 */
export function operatorListColumn(
  windowWidth: number,
  gutter = screenGutter(windowWidth),
): ListColumnStyle {
  return {
    alignSelf: "center",
    maxWidth:
      windowSizeClass(windowWidth) === "expanded" ? windowWidth : readableContentWidth(windowWidth),
    paddingHorizontal: gutter,
    width: "100%",
  };
}

export function useOperatorListColumn(): ListColumnStyle {
  return operatorListColumn(useWindowDimensions().width);
}

/** The primary count of a scanner stat block. */
export const STAT_PRIMARY_TYPE = { fontSize: 44, fontWeight: "700" } as const;
