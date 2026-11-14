/**
 * Representative colour of RGBA pixels (H44, H48), shared by web and mobile so a
 * logo gets the same hero tint on both. Transparent, near-white, near-black and
 * grey pixels are ignored, so a small vivid accent on a white or black logo is
 * the colour; the rest are bucketed and the bucket with the most (and most
 * saturated) pixels wins. `rgba` is RGBA, 4 bytes per pixel. Returns `#rrggbb`,
 * or null when there is no usable colour.
 */
export function pickDominantColor(rgba: ArrayLike<number>): string | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number; s: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i] as number;
    const g = rgba[i + 1] as number;
    const b = rgba[i + 2] as number;
    const a = rgba[i + 3] as number;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (a < 128 || min > 235 || max < 30 || max - min < 24) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.s += (max - min) / max;
    buckets.set(key, bucket);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  let bestScore = 0;
  for (const bucket of buckets.values()) {
    const score = bucket.n * (0.25 + bucket.s / bucket.n);
    if (score > bestScore) {
      bestScore = score;
      best = bucket;
    }
  }
  if (!best) return null;
  const { n } = best;
  const hex = (sum: number) =>
    Math.round(sum / n)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/**
 * Whether a logo's artwork runs into its own edges (H44), from RGBA pixels of a
 * `width`×`height` copy. A border ring that is fully transparent, or a single
 * near-white or near-black matte, counts as built-in margin; anything else
 * (artwork, or a coloured box filling the image) means the logo needs the
 * margin added around it so it does not touch its tile.
 */
export function logoTouchesEdge(rgba: ArrayLike<number>, width: number, height: number): boolean {
  if (width < 3 || height < 3 || rgba.length < width * height * 4) return false;
  let opaque = 0;
  let total = 0;
  let minLum = 255;
  let maxLum = 0;
  const visit = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    total += 1;
    if ((rgba[i + 3] as number) < 16) return;
    opaque += 1;
    const lum =
      0.2126 * (rgba[i] as number) +
      0.7152 * (rgba[i + 1] as number) +
      0.0722 * (rgba[i + 2] as number);
    const chroma =
      Math.max(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number) -
      Math.min(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number);
    // A coloured border pixel is never a neutral matte.
    if (chroma > 24) {
      minLum = 0;
      maxLum = 255;
      return;
    }
    minLum = Math.min(minLum, lum);
    maxLum = Math.max(maxLum, lum);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  // A few stray opaque pixels (anti-aliasing) still read as a transparent border.
  if (opaque <= total * 0.04) return false;
  const uniform = maxLum - minLum < 20;
  const matte = minLum > 235 || maxLum < 30;
  return !(uniform && matte && opaque === total);
}
