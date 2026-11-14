import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressPhoto, PHOTO_MAX_BYTES, UnsupportedPhotoError } from "@/lib/compress-image";

const MB = 1024 * 1024;
/** Encoded size per attempt: [width, quality] → bytes. */
let sizeOf: (width: number, quality: number | undefined) => number;
const attempts: { width: number; type: string; quality?: number }[] = [];

beforeEach(() => {
  attempts.length = 0;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (file: File) => {
      if (file.name.endsWith(".broken")) throw new Error("decode");
      return { width: 4000, height: 3000, close: vi.fn() };
    }),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type = "image/png",
    quality,
  ) {
    attempts.push({ width: this.width, type, quality });
    callback(new Blob([new Uint8Array(sizeOf(this.width, quality))], { type }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const photo = (bytes: number, name = "IMG_1.png", type = "image/png") =>
  new File([new Uint8Array(bytes)], name, { type });

describe("compressPhoto (#934, H16)", () => {
  it("passes a stored format within the cap through untouched", async () => {
    const file = photo(MB);
    expect(await compressPhoto(file)).toBe(file);
    expect(attempts).toEqual([]);
  });

  it("re-encodes an oversize photo as JPEG within 5 MB, lowering quality first", async () => {
    sizeOf = (_width, quality) => ((quality ?? 1) > 0.8 ? 6 * MB : 3 * MB);
    const result = await compressPhoto(photo(12 * MB));
    expect(result.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("IMG_1.jpg");
    expect(attempts.map((a) => a.quality)).toEqual([0.9, 0.82, 0.72]);
  });

  it("shrinks dimensions when the lowest quality still does not fit", async () => {
    sizeOf = (width) => (width >= 4000 ? 9 * MB : 4 * MB);
    const result = await compressPhoto(photo(20 * MB), { maxBytes: 5 * MB });
    expect(result.size).toBe(4 * MB);
    expect(attempts.at(-1)).toMatchObject({ width: 3000, quality: 0.9 });
  });

  it("converts a camera format the API does not store", async () => {
    sizeOf = () => MB;
    const result = await compressPhoto(photo(MB, "IMG_2.HEIC", ""));
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("IMG_2.jpg");
  });

  it("refuses other formats and images the browser cannot read", async () => {
    await expect(compressPhoto(photo(10, "a.gif", "image/gif"))).rejects.toBeInstanceOf(
      UnsupportedPhotoError,
    );
    await expect(compressPhoto(photo(10, "a.broken", "image/heic"))).rejects.toBeInstanceOf(
      UnsupportedPhotoError,
    );
  });
});
