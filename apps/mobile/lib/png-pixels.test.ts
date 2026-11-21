import { zlibSync } from "fflate";
import { decodePngRgba } from "./png-pixels";

function chunk(kind: string, body: Uint8Array): number[] {
  const length = body.length;
  // The decoder does not check CRCs, so zeros keep the fixture readable.
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...[...kind].map((c) => c.charCodeAt(0)),
    ...body,
    0,
    0,
    0,
    0,
  ];
}

/** A PNG with the given color type whose rows are already filtered. */
function png(
  width: number,
  height: number,
  colorType: number,
  rows: number[][],
  extra: [string, number[]][] = [],
): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header[8] = 8;
  header[9] = colorType;
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", header),
    ...extra.flatMap(([kind, body]) => chunk(kind, new Uint8Array(body))),
    ...chunk("IDAT", zlibSync(new Uint8Array(rows.flat()))),
    ...chunk("IEND", new Uint8Array()),
  ]);
}

describe("decodePngRgba", () => {
  it("reads RGBA through the sub, up, average and Paeth filters", () => {
    const pixels = [
      [10, 20, 30, 255, 40, 50, 60, 128],
      [70, 80, 90, 0, 100, 110, 120, 255],
    ];
    // Row 0 with Sub (1), row 1 with Up (2).
    const sub = [1, ...pixels[0].map((v, i) => (i < 4 ? v : (v - pixels[0][i - 4] + 256) & 0xff))];
    const up = [2, ...pixels[1].map((v, i) => (v - pixels[0][i] + 256) & 0xff)];
    expect([...decodePngRgba(png(2, 2, 6, [sub, up])).rgba]).toEqual(pixels.flat());

    // Average (3) and Paeth (4) on a second row; with an all-zero first row
    // Paeth predicts from the left pixel and Average from half of it.
    const zero = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const left = (row: number[], i: number) => (i < 4 ? 0 : row[i - 4]);
    const row = pixels[0];
    const average = [3, ...row.map((v, i) => (v - (left(row, i) >> 1) + 256) & 0xff)];
    const paeth = [4, ...row.map((v, i) => (v - left(row, i) + 256) & 0xff)];
    expect([...decodePngRgba(png(2, 2, 6, [zero, average])).rgba.slice(8)]).toEqual(row);
    expect([...decodePngRgba(png(2, 2, 6, [zero, paeth])).rgba.slice(8)]).toEqual(row);
  });

  it("expands RGB, gray and palette images to opaque or tRNS alpha", () => {
    expect([...decodePngRgba(png(1, 1, 2, [[0, 1, 2, 3]])).rgba]).toEqual([1, 2, 3, 255]);
    expect([...decodePngRgba(png(1, 1, 0, [[0, 9]])).rgba]).toEqual([9, 9, 9, 255]);
    expect([...decodePngRgba(png(1, 1, 4, [[0, 9, 7]])).rgba]).toEqual([9, 9, 9, 7]);
    const palette: [string, number[]][] = [
      ["PLTE", [255, 0, 0, 0, 0, 255]],
      ["tRNS", [0]],
    ];
    expect([...decodePngRgba(png(2, 1, 3, [[0, 0, 1]], palette)).rgba]).toEqual([
      255, 0, 0, 0, 0, 0, 255, 255,
    ]);
  });

  it("refuses data it cannot read", () => {
    expect(() => decodePngRgba(new Uint8Array(16))).toThrow("Not a PNG");
    const interlaced = png(1, 1, 6, [[0, 0, 0, 0, 0]]);
    interlaced[8 + 8 + 12] = 1;
    expect(() => decodePngRgba(interlaced)).toThrow("Unsupported PNG layout");
  });
});

test("reads 16-bit PNGs, as iOS writes wide-color photos, by their high bytes", () => {
  // A 4x4 red-to-blue gradient saved as 16-bit RGBA.
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEEAYAAAD5YUI9AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCxMSMgXMz4zEAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTE5VDE4OjUwOjA1KzAwOjAwclbzDwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0xOVQxODo1MDowNSswMDowMAMLS7MAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMTlUMTg6NTA6MDUrMDA6MDBUHmpsAAAAI0lEQVQI12P8/5+BgYEBQmIDLKtXMzCEhjIwkK2AEWIBbisAqDIMA5z5kPUAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const { width, height, rgba } = decodePngRgba(png);
  expect([width, height]).toEqual([4, 4]);
  expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  expect(Array.from(rgba.subarray(rgba.length - 4))).toEqual([0, 0, 255, 255]);
});
