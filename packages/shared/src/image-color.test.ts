import { describe, expect, it } from "vitest";
import { pickDominantColor } from "./image-color";

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

  it("prefers the larger and the more saturated bucket", () => {
    expect(
      pickDominantColor([...repeat(px(200, 30, 30), 30), ...repeat(px(30, 30, 200), 10)]),
    ).toBe("#c81e1e");
    expect(
      pickDominantColor([...repeat(px(130, 128, 126), 20), ...repeat(px(20, 60, 220), 20)]),
    ).toBe("#143cdc");
  });

  it("ignores transparent, near-white and near-black pixels", () => {
    expect(
      pickDominantColor([
        ...repeat(px(255, 255, 255), 200),
        ...repeat(px(0, 0, 0), 200),
        ...repeat(px(200, 30, 30, 0), 200),
        ...repeat(px(51, 102, 204), 10),
      ]),
    ).toBe("#3366cc");
  });

  it("is null for monochrome or transparent logos", () => {
    expect(pickDominantColor(repeat(px(255, 255, 255), 50))).toBeNull();
    expect(pickDominantColor(repeat(px(0, 0, 0), 50))).toBeNull();
    expect(pickDominantColor(repeat(px(200, 30, 30, 0), 50))).toBeNull();
  });
});
