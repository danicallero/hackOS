import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";
import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";
import { apiImageSource } from "./directory";

/**
 * Representative colour of a logo or a profile photo (H44, H48), computed on
 * the device so nothing is stored server-side: it tints the company and
 * person page heroes. Transparent pixels and near-white/near-black ones are
 * ignored; the rest are bucketed and the bucket with the most (and most
 * saturated) pixels wins. `rgba` is RGBA, 4 bytes per pixel. Returns
 * `#rrggbb`, or null when there is no usable colour.
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
    if (a < 128 || min > 235 || max < 30) continue;
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

const SAMPLE = 24;

/** Download the image, draw it at 24x24 with Skia and pick its colour. */
async function decodeImageTint(uri: string): Promise<string | null> {
  const source = apiImageSource(uri);
  const response = await fetch(source.uri, { headers: source.headers });
  if (!response.ok) return null;
  const data = Skia.Data.fromBytes(new Uint8Array(await response.arrayBuffer()));
  const image = Skia.Image.MakeImageFromEncoded(data);
  const surface = Skia.Surface.Make(SAMPLE, SAMPLE);
  if (!image || !surface) return null;
  surface
    .getCanvas()
    .drawImageRect(
      image,
      { x: 0, y: 0, width: image.width(), height: image.height() },
      { x: 0, y: 0, width: SAMPLE, height: SAMPLE },
      Skia.Paint(),
    );
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: SAMPLE,
    height: SAMPLE,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  // Unpremul RGBA_8888 reads back as bytes; floats would mean a different format.
  return pixels && !(pixels instanceof Float32Array) ? pickDominantColor(pixels) : null;
}

type Listener = () => void;

/**
 * In-memory colour per image URL (null = no usable colour), with in-flight
 * work deduplicated and at most `concurrency` decodes running, each started
 * through `schedule` (off the interaction path) so lists never stutter.
 */
export function createTintCache(
  decode: (uri: string) => Promise<string | null>,
  schedule: (run: () => void) => void,
  concurrency = 2,
) {
  const done = new Map<string, string | null>();
  const inflight = new Map<string, Promise<string | null>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  const listeners = new Map<string, Set<Listener>>();

  function pump() {
    while (running < concurrency && waiting.length > 0) {
      running += 1;
      (waiting.shift() as () => void)();
    }
  }

  function prefetch(uri: string | null | undefined): Promise<string | null> | null {
    if (!uri) return null;
    if (done.has(uri)) return Promise.resolve(done.get(uri) ?? null);
    const pending = inflight.get(uri);
    if (pending) return pending;
    const promise = new Promise<string | null>((resolve) => {
      waiting.push(() =>
        schedule(() => {
          decode(uri)
            .catch((error: unknown) => {
              if (__DEV__) console.warn("Image tint failed", uri, error);
              return null;
            })
            .then((color) => {
              done.set(uri, color);
              inflight.delete(uri);
              running -= 1;
              resolve(color);
              for (const listener of listeners.get(uri) ?? []) listener();
              listeners.delete(uri);
              pump();
            });
        }),
      );
    });
    inflight.set(uri, promise);
    pump();
    return promise;
  }

  return {
    prefetch,
    /** undefined = not computed (yet); null = computed, no usable colour. */
    get: (uri: string | null | undefined) => (uri ? done.get(uri) : null),
    subscribe(uri: string, listener: Listener) {
      const set = listeners.get(uri) ?? new Set();
      set.add(listener);
      listeners.set(uri, set);
      return () => {
        set.delete(listener);
      };
    },
    clear() {
      done.clear();
    },
  };
}

const cache = createTintCache(decodeImageTint, (run) => {
  InteractionManager.runAfterInteractions(run);
});

/** Compute a logo's or photo's colour in the background, before its page opens. */
export function prefetchImageTint(uri: string | null | undefined): void {
  void cache.prefetch(uri);
}

export function getCachedImageTint(uri: string | null | undefined): string | null | undefined {
  return cache.get(uri);
}

/** Forget every colour (sign-out): a photo hidden later must not linger. */
export function clearImageTints(): void {
  cache.clear();
}

/**
 * The image's colour for a page hero. A prefetched colour is there on the very
 * first render (`fromCache`), so the hero draws already tinted; otherwise the
 * colour arrives later and the hero fades in. null = no image or colour.
 */
export function useImageTint(uri: string | null | undefined): {
  color: string | null;
  fromCache: boolean;
} {
  const [, rerender] = useState(0);
  const [initial] = useState(() => ({ uri, hit: cache.get(uri) !== undefined }));
  useEffect(() => {
    if (!uri) return;
    const off = cache.subscribe(uri, () => rerender((n) => n + 1));
    void cache.prefetch(uri);
    return off;
  }, [uri]);
  const color = cache.get(uri) ?? null;
  return { color, fromCache: initial.uri === uri && initial.hit };
}
