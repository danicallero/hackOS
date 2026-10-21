import { readableContentWidth, screenGutter, sizeClassValue } from "@/theme/layout";

describe("size-class layout tokens", () => {
  it("falls back to the next smaller class when one is missing", () => {
    expect(sizeClassValue("expanded", { compact: 1 })).toBe(1);
    expect(sizeClassValue("expanded", { compact: 1, medium: 2 })).toBe(2);
    expect(sizeClassValue("medium", { compact: 1, expanded: 3 })).toBe(1);
    expect(sizeClassValue("expanded", { compact: 1, medium: 2, expanded: 3 })).toBe(3);
  });

  it("widens the gutter with the window, on the shared breakpoints", () => {
    expect(screenGutter(390)).toBe(16);
    expect(screenGutter(600)).toBe(24);
    expect(screenGutter(839)).toBe(24);
    expect(screenGutter(840)).toBe(32);
  });

  it("bounds reading panes, not the window", () => {
    expect(readableContentWidth(390)).toBe(720);
    expect(readableContentWidth(1366)).toBe(960);
  });
});
