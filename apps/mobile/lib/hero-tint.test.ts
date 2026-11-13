import { heroTint } from "./hero-tint";

describe("hero tint", () => {
  it("fades the logo colour to transparent in both schemes", () => {
    for (const dark of [false, true]) {
      expect(heroTint("#3366cc", dark).gradient).toMatch(
        /^linear-gradient\(to bottom, rgba\(\d+,\d+,\d+,0\.\d+\) 0%, rgba\(\d+,\d+,\d+,0\) 100%\)$/,
      );
    }
  });

  it("uses the logo colour as is in light mode and darkens it in dark mode", () => {
    expect(heroTint("#3366cc", false).gradient).toContain("rgba(51,102,204,0.5)");
    expect(heroTint("#3366cc", true).gradient).toContain("rgba(31,61,122,0.7)");
  });

  it("picks the foreground by luminance", () => {
    // Light mode: the tint is at most half strength over white, so it stays light.
    expect(heroTint("#001f5c", false).foreground).toBe("black");
    expect(heroTint("#ffe066", false).foreground).toBe("black");
    // Dark mode: the darkened tint over black reads with white.
    expect(heroTint("#001f5c", true).foreground).toBe("white");
    expect(heroTint("#ffe066", true).foreground).toBe("white");
  });

  it("falls back to a neutral tint without a usable colour", () => {
    expect(heroTint(null, false).gradient).toContain("rgba(142,142,147,");
    expect(heroTint("nope", false).gradient).toContain("rgba(142,142,147,");
  });
});
