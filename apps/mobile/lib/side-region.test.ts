import {
  ANDROID_RAIL_COLUMN_SIZE,
  effectiveSideInsets,
  isTabletRailWindow,
  NO_SIDE_REGION,
  navigationSideInsets,
  SIDE_REGION_MIN_SIZE,
  sideRegionForInsets,
} from "./side-region";

describe("side region", () => {
  it("finds the reserved column from the asymmetric insets", () => {
    expect(sideRegionForInsets({ left: 0, right: 84 })).toEqual({ edge: "right", size: 84 });
    expect(sideRegionForInsets({ left: 84, right: 0 })).toEqual({ edge: "left", size: 84 });
  });

  it("keeps every bar horizontal without one", () => {
    expect(sideRegionForInsets({ left: 0, right: 0 })).toEqual(NO_SIDE_REGION);
    // A phone in landscape with a notch cut-out is not a reserved column.
    expect(sideRegionForInsets({ left: 47, right: 47 })).toEqual(NO_SIDE_REGION);
    expect(sideRegionForInsets({ left: 0, right: SIDE_REGION_MIN_SIZE - 1 })).toEqual(
      NO_SIDE_REGION,
    );
  });
});

describe("landscape tablet navigation", () => {
  const noInsets = { left: 0, right: 0 };

  it("reserves a left rail in landscape and restores the bottom bar in portrait", () => {
    expect(navigationSideInsets(noInsets, null, { width: 1366, height: 1032 }, "ios")).toEqual({
      left: 200,
      right: 0,
    });
    expect(navigationSideInsets(noInsets, null, { width: 1032, height: 1366 }, "ios")).toEqual(
      noInsets,
    );
  });

  it("keeps the Duo inner window on its compact rail", () => {
    expect(navigationSideInsets(noInsets, null, { width: 951, height: 669 }, "ios")).toEqual({
      left: 64,
      right: 0,
    });
    expect(
      navigationSideInsets({ left: 0, right: 84 }, "right", { width: 951, height: 669 }, "ios"),
    ).toEqual({ left: 0, right: 84 });
  });

  it("keeps short phone windows horizontal and gives Android tablets a rail", () => {
    expect(navigationSideInsets(noInsets, null, { width: 844, height: 390 }, "ios")).toEqual(
      noInsets,
    );
    expect(navigationSideInsets(noInsets, null, { width: 1366, height: 1032 }, "android")).toEqual({
      left: ANDROID_RAIL_COLUMN_SIZE,
      right: 0,
    });
  });

  it("preserves the system's foldable column instead of adding another rail", () => {
    expect(
      navigationSideInsets({ left: 0, right: 84 }, "right", { width: 1366, height: 1032 }, "ios"),
    ).toEqual({ left: 0, right: 84 });
    expect(navigationSideInsets(noInsets, "right", { width: 1366, height: 1032 }, "ios")).toEqual({
      left: 0,
      right: 64,
    });
  });
});

describe("Android rail column", () => {
  it("clears the whole bar: its inset, pill and a gap", () => {
    // Bar right edge = 20 (system line) - 4 (rim) + 52 (pill) = 68pt.
    expect(ANDROID_RAIL_COLUMN_SIZE).toBeGreaterThanOrEqual(68 + 8);
  });

  it("reserves it for the Fold inner display in portrait and a compact cover", () => {
    const noInsets = { left: 0, right: 0 };
    expect(navigationSideInsets(noInsets, null, { width: 673, height: 841 }, "android").left).toBe(
      ANDROID_RAIL_COLUMN_SIZE,
    );
    expect(navigationSideInsets(noInsets, null, { width: 400, height: 500 }, "android").left).toBe(
      ANDROID_RAIL_COLUMN_SIZE,
    );
  });
});

describe("isTabletRailWindow", () => {
  const none = { left: 0, right: 0 };
  it("flags only wide iOS landscape windows without a system column", () => {
    expect(isTabletRailWindow(none, null, { width: 1366, height: 1032 }, "ios")).toBe(true);
    expect(isTabletRailWindow(none, null, { width: 951, height: 669 }, "ios")).toBe(false);
    expect(isTabletRailWindow(none, null, { width: 1032, height: 1366 }, "ios")).toBe(false);
    expect(isTabletRailWindow(none, "right", { width: 1366, height: 1032 }, "ios")).toBe(false);
    expect(isTabletRailWindow(none, null, { width: 1366, height: 1032 }, "android")).toBe(false);
  });
});

describe("effectiveSideInsets", () => {
  it("adds the system's column on the reported edge when the insets do not report it", () => {
    expect(effectiveSideInsets({ left: 0, right: 0 }, "left")).toEqual({ left: 64, right: 0 });
    expect(effectiveSideInsets({ left: 0, right: 0 }, "right")).toEqual({ left: 0, right: 64 });
  });

  it("leaves reported insets and a missing edge alone", () => {
    expect(effectiveSideInsets({ left: 0, right: 84 }, "right")).toEqual({ left: 0, right: 84 });
    expect(effectiveSideInsets({ left: 0, right: 0 }, null)).toEqual({ left: 0, right: 0 });
  });
});
