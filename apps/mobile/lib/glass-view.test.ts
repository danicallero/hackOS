import { glassFallbackSurface } from "@/components/glass-view";
import { colors } from "@/theme/colors";

describe("GlassView fallback surfaces (H55)", () => {
  it("keeps an explicit dark surface dark when Android is in light mode", () => {
    expect(glassFallbackSurface("dark", "light")).toBe(colors.glassDarkSurface);
  });

  it("keeps an explicit light surface light when Android is in dark mode", () => {
    expect(glassFallbackSurface("light", "dark")).toBe(colors.glassLightSurface);
  });

  it("follows the current system scheme only for auto", () => {
    expect(glassFallbackSurface("auto", "dark")).toBe(colors.elevatedSurface);
    expect(glassFallbackSurface("auto", "light")).toBe(colors.surface);
  });
});
