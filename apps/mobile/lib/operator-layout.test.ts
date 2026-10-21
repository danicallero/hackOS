import {
  ACTION_ROW_MIN_WIDTH,
  OPERATOR_COLUMN_MAX,
  OPERATOR_SHORT_HEIGHT,
  operatorLayout,
  operatorListColumn,
  READER_SYMBOL_SIZE,
  readerFit,
  SCAN_FRAME,
  STAT_ROW_MIN_WIDTH,
  SURFACE_ACTIONS_HEIGHT,
  SURFACE_READER_MIN_HEIGHT,
  SURFACE_STATS_HEIGHT,
  scanFrameSize,
  surfaceFit,
} from "@/theme/layout-screens";

const base = { windowWidth: 390, windowHeight: 844, fontScale: 1, columnWidth: null };

describe("operator layout", () => {
  it("keeps the phone layout stacked with the same gutter on both edges", () => {
    const layout = operatorLayout(base);
    expect(layout.gutter).toBe(16);
    expect(layout.stats).toBe("stacked");
    expect(layout.actions).toBe("column");
    expect(layout.shortWindow).toBe(false);
    expect(layout.symbolSize).toBe(READER_SYMBOL_SIZE.regular);
  });

  it("bounds the column on wide windows and uses a row of equal stats", () => {
    const layout = operatorLayout({ ...base, windowWidth: 1400, windowHeight: 900 });
    expect(layout.columnMaxWidth).toBe(OPERATOR_COLUMN_MAX.expanded);
    expect(layout.stats).toBe("row");
    expect(layout.actions).toBe("row");
  });

  it("decides from the measured column when the window gives it less (rail, Split View)", () => {
    const wide = operatorLayout({ ...base, windowWidth: 700, columnWidth: STAT_ROW_MIN_WIDTH });
    expect(wide.stats).toBe("row");
    expect(wide.actions).toBe("column");
    const roomy = operatorLayout({ ...base, windowWidth: 700, columnWidth: ACTION_ROW_MIN_WIDTH });
    expect(roomy.actions).toBe("row");
    const narrow = operatorLayout({
      ...base,
      windowWidth: 700,
      columnWidth: STAT_ROW_MIN_WIDTH - 1,
    });
    expect(narrow.stats).toBe("stacked");
  });

  it("estimates the column from the window before the first measurement", () => {
    // 565pt Stage Manager window: the compact column caps at 440pt: stats on one row, actions stacked.
    const layout = operatorLayout({ ...base, windowWidth: 565, windowHeight: 1045 });
    expect(layout.gutter).toBe(16);
    expect(layout.stats).toBe("row");
    expect(layout.actions).toBe("column");
  });

  it("stacks everything at accessibility text sizes", () => {
    const layout = operatorLayout({ ...base, windowWidth: 1400, fontScale: 2 });
    expect(layout.stats).toBe("list");
    expect(layout.actions).toBe("column");
  });

  it("shrinks the reader symbol in short windows", () => {
    for (const windowHeight of [300, OPERATOR_SHORT_HEIGHT - 1]) {
      const layout = operatorLayout({ ...base, windowWidth: 844, windowHeight });
      expect(layout.shortWindow).toBe(true);
      expect(layout.symbolSize).toBe(READER_SYMBOL_SIZE.short);
    }
    expect(operatorLayout({ ...base, windowHeight: OPERATOR_SHORT_HEIGHT }).shortWindow).toBe(
      false,
    );
  });

  it("sizes the scan square to the camera viewport", () => {
    expect(scanFrameSize(0, 0)).toBe(SCAN_FRAME.phone);
    expect(scanFrameSize(390, 700)).toBe(SCAN_FRAME.phone);
    expect(scanFrameSize(400, 300)).toBe(210);
    expect(scanFrameSize(200, 200)).toBe(SCAN_FRAME.min);
    expect(scanFrameSize(1400, 900)).toBe(SCAN_FRAME.large);
  });

  it("centres list content with equal gutters, filling an expanded window", () => {
    expect(operatorListColumn(390)).toEqual({
      alignSelf: "center",
      maxWidth: 720,
      paddingHorizontal: 16,
      width: "100%",
    });
    expect(operatorListColumn(565).paddingHorizontal).toBe(16);
    expect(operatorListColumn(700).paddingHorizontal).toBe(24);
    expect(operatorListColumn(1400)).toMatchObject({ maxWidth: 1400, paddingHorizontal: 32 });
  });

  it("keeps the regular stats and actions while they fit with a reader area", () => {
    const layout = { stats: "row", actions: "column" } as const;
    const needed =
      SURFACE_STATS_HEIGHT.row + SURFACE_ACTIONS_HEIGHT.column + SURFACE_READER_MIN_HEIGHT;
    expect(surfaceFit(layout, needed, 1)).toEqual({ ...layout, dense: false });
    expect(surfaceFit(layout, null, 1).dense).toBe(false);
  });

  it("goes dense in a short pane instead of scrolling (330pt tall, 440pt wide)", () => {
    const fit = surfaceFit({ stats: "row", actions: "column" }, 330, 1);
    expect(fit).toEqual({ stats: "compact", actions: "compact", dense: true });
    const denseNeeds =
      SURFACE_STATS_HEIGHT.compact + SURFACE_ACTIONS_HEIGHT.compact + SURFACE_READER_MIN_HEIGHT;
    expect(denseNeeds).toBeLessThanOrEqual(330);
  });

  it("keeps stacked layouts at accessibility sizes and lets the reader give way", () => {
    expect(surfaceFit({ stats: "list", actions: "column" }, 300, 2)).toEqual({
      stats: "list",
      actions: "column",
      dense: false,
    });
  });

  it("shrinks, then drops the caption, then hides the reader symbol with its area", () => {
    expect(readerFit(null, 1)).toEqual({
      symbolSize: READER_SYMBOL_SIZE.regular,
      showCaption: true,
    });
    expect(readerFit(400, 1).symbolSize).toBe(READER_SYMBOL_SIZE.regular);
    const small = readerFit(130, 1);
    expect(small.symbolSize).toBeLessThan(READER_SYMBOL_SIZE.regular);
    expect(small.showCaption).toBe(true);
    expect(readerFit(70, 1)).toEqual({ symbolSize: 28, showCaption: false });
    expect(readerFit(40, 1)).toEqual({ symbolSize: 0, showCaption: false });
  });
});
