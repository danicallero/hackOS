import { describe, expect, it } from "vitest";
import { logoTouchesEdge, pickDominantColor } from "./image-color";

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

/** A `size`² image: `inner` inside a `pad`-pixel ring of `ring`. */
function framed(size: number, pad: number, ring: number[], inner: number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const edge = x < pad || y < pad || x >= size - pad || y >= size - pad;
      out.push(...(edge ? ring : inner));
    }
  return out;
}

describe("logoTouchesEdge", () => {
  const brand = px(20, 90, 200);

  it("treats a transparent ring as built-in margin", () => {
    expect(logoTouchesEdge(framed(16, 2, px(0, 0, 0, 0), brand), 16, 16)).toBe(false);
  });

  it("treats a white or black matte as built-in margin", () => {
    expect(logoTouchesEdge(framed(16, 2, px(255, 255, 255), brand), 16, 16)).toBe(false);
    expect(logoTouchesEdge(framed(16, 2, px(5, 5, 5), brand), 16, 16)).toBe(false);
  });

  it("flags artwork that reaches the edge", () => {
    expect(logoTouchesEdge(repeat(brand, 256), 16, 16)).toBe(true);
    // Half the border is a coloured box, half white (a box logo beside its wordmark).
    const halves = Array.from({ length: 256 }, (_, i) =>
      i % 16 < 8 ? brand : px(255, 255, 255),
    ).flat();
    expect(logoTouchesEdge(halves, 16, 16)).toBe(true);
  });

  it("flags a mixed grey border", () => {
    expect(logoTouchesEdge(framed(16, 1, px(128, 128, 128), brand), 16, 16)).toBe(true);
  });
});
