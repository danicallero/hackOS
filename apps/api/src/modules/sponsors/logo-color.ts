import sharp from "sharp";

/**
 * Representative colour of a company logo (H44), used by the mobile company
 * page to tint its hero. Transparent pixels and near-white/near-black
 * backgrounds are ignored; the remaining pixels are bucketed and the bucket
 * with the most (and most saturated) pixels wins. Returns `#rrggbb`, or null
 * when the image has no usable colour or cannot be decoded.
 */
export async function logoColor(bytes: Uint8Array | Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(bytes)
      .resize(64, 64, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<number, { n: number; r: number; g: number; b: number; s: number }>();
    for (let i = 0; i + 3 < data.length; i += info.channels) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      const a = data[i + 3] as number;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (a < 128 || min > 235 || max < 30) continue;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, s: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.s += max === 0 ? 0 : (max - min) / max;
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
    const hex = (sum: number) =>
      Math.round(sum / (best as { n: number }).n)
        .toString(16)
        .padStart(2, "0");
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}

/** Download a public logo and compute its colour; any failure yields null. */
export async function logoColorFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await logoColor(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
