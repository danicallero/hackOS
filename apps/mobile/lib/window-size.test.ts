import {
  COMPACT_MAX_WIDTH,
  contentFrameWidth,
  EXPANDED_MAX_CONTENT_WIDTH,
  isCompactPassportWindow,
  listDetailLayout,
  MAX_CONTENT_WIDTH,
  MEDIUM_MAX_WIDTH,
  TABLET_TAB_BAR_MIN_WIDTH,
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
    expect(listDetailLayout(673, 841, "android")).toEqual({
      enabled: true,
      gutter: 0,
      listWidth: 340,
    });
    expect(listDetailLayout(841, 673, "android").enabled).toBe(true);
    expect(listDetailLayout(600, 841, "android").enabled).toBe(false);
    expect(listDetailLayout(844, 390, "android").enabled).toBe(false);
    expect(listDetailLayout(951, 669, "ios").enabled).toBe(true);
    expect(listDetailLayout(1366, 1032, "ios").listWidth).toBe(420);
  });
  it("splits at a book-pose crease: list before it, detail after it", () => {
    const crease = { x: 470, width: 12 };
    expect(listDetailLayout(951, 669, "ios", crease)).toEqual({
      enabled: true,
      gutter: 12,
      listWidth: 470,
    });
    // A crease too close to an edge leaves a page too narrow to use; the usual split applies.
    expect(listDetailLayout(951, 669, "ios", { x: 200, width: 12 })).toEqual({
      enabled: true,
      gutter: 0,
      listWidth: 380,
    });
    // Narrow windows stay single pane whatever the crease.
    expect(listDetailLayout(600, 841, "ios", { x: 300, width: 12 }).enabled).toBe(false);
  });
});

describe("documented breakpoint exceptions", () => {
  it("keeps verified foldable and tablet windows on their geometry", () => {
    // Fold inner portrait is medium and keeps the phone tab bar; iPad portrait gets the tablet one.
    expect(windowSizeClass(673)).toBe("medium");
    expect(673).toBeLessThan(TABLET_TAB_BAR_MIN_WIDTH);
    expect(744).toBeGreaterThanOrEqual(TABLET_TAB_BAR_MIN_WIDTH);
    // Duo book is expanded yet not a tablet landscape window.
    expect(windowSizeClass(951)).toBe("expanded");
    expect(listDetailLayout(951, 669, "ios").listWidth).toBe(380);
    expect(listDetailLayout(673, 841, "android").listWidth).toBe(340);
  });
});
