import { describe, expect, it } from "vitest";
import { pickDominantColor } from "./company";

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
const repeat = (pixel: number[], n: number) => Array.from({ length: n }, () => pixel).flat();

describe("pickDominantColor", () => {
  it("returns a solid colour as is", () => {
    expect(pickDominantColor(repeat(px(51, 102, 204), 64))).toBe("#3366cc");
  });

  it("takes a small vivid accent over a large grey or white body", () => {
    expect(
      pickDominantColor([
        ...repeat(px(255, 255, 255), 300),
        ...repeat(px(60, 60, 62), 200),
        ...repeat(px(240, 120, 20), 12),
      ]),
    ).toBe("#f07814");
  });

  it("does not blend two vivid colours into a muddy one", () => {
    expect(
      pickDominantColor([...repeat(px(220, 30, 30), 30), ...repeat(px(30, 30, 220), 20)]),
    ).toBe("#dc1e1e");
  });

  it("is null for monochrome or transparent logos", () => {
    expect(pickDominantColor(repeat(px(255, 255, 255), 50))).toBeNull();
    expect(pickDominantColor(repeat(px(0, 0, 0), 50))).toBeNull();
    expect(pickDominantColor(repeat(px(200, 30, 30, 0), 50))).toBeNull();
  });
});
