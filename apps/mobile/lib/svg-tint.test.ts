import { pickDominantColor } from "@hackos/shared/image-color";
import { isSvg, svgTintSource } from "./svg-tint";

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

test("recognises SVG documents, with or without an XML prolog", () => {
  expect(isSvg(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true);
  expect(isSvg(bytes('<?xml version="1.0"?>\n<svg/>'))).toBe(true);
  expect(isSvg(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBe(false);
});

test("hands over the largest embedded raster", () => {
  const small = btoa("small");
  const large = btoa("the larger raster");
  const source = svgTintSource(
    `<svg><image href="data:image/png;base64,${small}"/><image href="data:image/jpeg;base64,${large}"/></svg>`,
  );
  expect(source).toEqual({ kind: "raster", bytes: bytes("the larger raster") });
});

test("reads paint colours from attributes and styles", () => {
  const source = svgTintSource(
    `<svg><path fill="#e30613"/><path style="fill:#e30613;stroke:#fff"/><rect fill="none"/><circle stroke="rgb(0, 0, 0)"/></svg>`,
  );
  expect(source?.kind).toBe("paint");
  if (source?.kind !== "paint") return;
  expect(source.rgba.length).toBe(16);
  expect(pickDominantColor(source.rgba)).toBe("#e30613");
});

test("an SVG with no colour or raster offers nothing", () => {
  expect(svgTintSource('<svg><path d="M0 0"/></svg>')).toBeNull();
});
