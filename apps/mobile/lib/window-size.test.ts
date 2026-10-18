import {
  COMPACT_MAX_WIDTH,
  contentFrameWidth,
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
    expect(contentFrameWidth(841)).toBe(MAX_CONTENT_WIDTH);
    expect(contentFrameWidth(1280)).toBe(MAX_CONTENT_WIDTH);
  });
});
