import { unzlibSync } from "fflate";

/**
 * Decodes a small 8-bit, non-interlaced PNG into RGBA bytes. It only has to
 * read the thumbnails `expo-image-manipulator` writes for logo tints (H44), so
 * the app does not ship a native graphics library just to read 24x24 pixels.
 * Throws on anything else; the tint cache treats that as "no colour".
 */
export function decodePngRgba(png: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) {
    throw new Error("Not a PNG");
  }
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const kind = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (kind === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = body[8];
      colorType = body[9] as number;
      if (depth !== 8 || body[12] !== 0) throw new Error("Unsupported PNG layout");
    } else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") transparency = body;
    else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || !width || !height) throw new Error("Unsupported PNG colour type");

  const compressed = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of data) {
    compressed.set(part, at);
    at += part.length;
  }
  const raw = unzlibSync(compressed);
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (pixels[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0;
      const corner =
        y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] as number) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (filter !== 0) throw new Error("Unknown PNG filter");
      pixels[y * stride + x] = ((line[x] as number) + predictor) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const d = i * 4;
    if (colorType === 6) rgba.set(pixels.subarray(s, s + 4), d);
    else if (colorType === 2) {
      rgba.set(pixels.subarray(s, s + 3), d);
      rgba[d + 3] = 255;
    } else if (colorType === 3) {
      const index = pixels[s] as number;
      if (!palette) throw new Error("PNG palette missing");
      rgba.set(palette.subarray(index * 3, index * 3 + 3), d);
      rgba[d + 3] =
        transparency && index < transparency.length ? (transparency[index] as number) : 255;
    } else {
      const grey = pixels[s] as number;
      rgba[d] = grey;
      rgba[d + 1] = grey;
      rgba[d + 2] = grey;
      rgba[d + 3] = colorType === 4 ? (pixels[s + 1] as number) : 255;
    }
  }
  return { width, height, rgba };
}
