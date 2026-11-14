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
