import {
  COMPACT_MAX_WIDTH,
  contentFrameWidth,
  EXPANDED_MAX_CONTENT_WIDTH,
  isCompactPassportWindow,
  listDetailLayout,
  MAX_CONTENT_WIDTH,
  MEDIUM_MAX_WIDTH,
  windowSizeClass,
} from "./window-size";

describe("window size classes", () => {
  it("classifies the windows of phones, foldables and tablets by width alone", () => {
    expect(windowSizeClass(360)).toBe("compact"); // cover display
    expect(windowSizeClass(412)).toBe("compact"); // phone
    expect(windowSizeClass(COMPACT_MAX_WIDTH - 1)).toBe("compact");
    expect(windowSizeClass(COMPACT_MAX_WIDTH)).toBe("medium");
    expect(windowSizeClass(673)).toBe("medium"); // Galaxy Z Fold inner, portrait
    expect(windowSizeClass(MEDIUM_MAX_WIDTH - 1)).toBe("medium");
    expect(windowSizeClass(MEDIUM_MAX_WIDTH)).toBe("expanded"); // Pixel Fold inner
    expect(windowSizeClass(1280)).toBe("expanded"); // tablet
  });

  it("never lets content grow past the readable column", () => {
    expect(contentFrameWidth(390)).toBe(390);
    expect(contentFrameWidth(MAX_CONTENT_WIDTH)).toBe(MAX_CONTENT_WIDTH);
    expect(contentFrameWidth(841)).toBe(841); // expanded: most of the width
    expect(contentFrameWidth(1280)).toBe(EXPANDED_MAX_CONTENT_WIDTH);
  });
});

describe("foldable window layouts", () => {
  it("distinguishes a passport cover from a classic tall cover", () => {
    expect(isCompactPassportWindow(440, 600)).toBe(true);
    expect(isCompactPassportWindow(390, 844)).toBe(false);
    expect(isCompactPassportWindow(844, 390)).toBe(false);
    expect(isCompactPassportWindow(673, 841)).toBe(false);
  });
  it("opens Android folds into two panes while keeping short landscape phones single pane", () => {
    expect(listDetailLayout(673, 841, "android")).toEqual({ enabled: true, listWidth: 300 });
    expect(listDetailLayout(841, 673, "android").enabled).toBe(true);
    expect(listDetailLayout(600, 841, "android").enabled).toBe(false);
    expect(listDetailLayout(844, 390, "android").enabled).toBe(false);
    expect(listDetailLayout(951, 669, "ios").enabled).toBe(true);
    expect(listDetailLayout(1366, 1032, "ios").listWidth).toBe(420);
  });
});
