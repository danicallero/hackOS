import { logoTouchesEdge, pickDominantColor } from "@hackos/shared/image-color";
import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { strFromU8 } from "fflate";
import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";
import { apiImageSource } from "./directory";
import { decodePngRgba } from "./png-pixels";
import { isSvg, svgTintSource } from "./svg-tint";

const SAMPLE = 24;

/** What an image's pixels say: its colour, and whether its artwork runs into its edges (H44). */
export interface ImageReading {
  color: string | null;
  bleed: boolean;
}

let sampleSequence = 0;

/**
 * Download the image, let the platform scale it to 24x24 as a PNG and read its
 * colour and edges. An SVG is read through `svgTintSource`: its embedded
 * raster, else its paint colours. The original and the thumbnail are cache files removed
 * straight away, so a hidden photo is not left on disk.
 */
async function decodeImageTint(uri: string): Promise<ImageReading | null> {
  const source = apiImageSource(uri);
  const response = await fetch(source.uri, { headers: source.headers });
  if (!response.ok) return null;
  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  if (isSvg(bytes)) {
    const svg = svgTintSource(strFromU8(bytes));
    if (!svg) return null;
    if (svg.kind === "paint") return { color: pickDominantColor(svg.rgba), bleed: false };
    bytes = svg.bytes;
  }
  sampleSequence += 1;
  const original = new File(Paths.cache, `tint-${sampleSequence}`);
  let thumbnail: File | null = null;
  try {
    original.write(bytes);
    const image = await ImageManipulator.manipulate(original.uri)
      .resize({ width: SAMPLE, height: SAMPLE })
      .renderAsync();
    thumbnail = new File((await image.saveAsync({ format: SaveFormat.PNG })).uri);
    const { width, height, rgba } = decodePngRgba(await thumbnail.bytes());
    return { color: pickDominantColor(rgba), bleed: logoTouchesEdge(rgba, width, height) };
  } finally {
    for (const file of [original, thumbnail]) {
      try {
        if (file?.exists) file.delete();
      } catch {
        // A leftover cache file is cleared by the system.
      }
    }
  }
}

type Listener = () => void;

/**
 * In-memory colour per image URL (null = no usable colour), with in-flight
 * work deduplicated and at most `concurrency` decodes running, each started
 * through `schedule` (off the interaction path) so lists never stutter.
 */
export function createTintCache<T = string>(
  decode: (uri: string) => Promise<T | null>,
  schedule: (run: () => void) => void,
  concurrency = 2,
) {
  const done = new Map<string, T | null>();
  const inflight = new Map<string, Promise<T | null>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  const listeners = new Map<string, Set<Listener>>();

  function pump() {
    while (running < concurrency && waiting.length > 0) {
      running += 1;
      (waiting.shift() as () => void)();
    }
  }

  function prefetch(uri: string | null | undefined): Promise<T | null> | null {
    if (!uri) return null;
    if (done.has(uri)) return Promise.resolve(done.get(uri) ?? null);
    const pending = inflight.get(uri);
    if (pending) return pending;
    const promise = new Promise<T | null>((resolve) => {
      waiting.push(() =>
        schedule(() => {
          void decode(uri)
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
  const reading = cache.get(uri);
  return reading === undefined ? undefined : (reading?.color ?? null);
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
  /** True once the colour is known to be there or not: no image, or it was decoded (or failed). */
  settled: boolean;
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
  const color = cache.get(uri)?.color ?? null;
  return {
    color,
    settled: !uri || cache.get(uri) !== undefined,
    fromCache: initial.uri === uri && initial.hit,
  };
}

/** True once an image is known to run into its own edges, so its tile adds the margin (H44). */
export function useImageBleed(uri: string | null | undefined): boolean {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!uri) return;
    const off = cache.subscribe(uri, () => rerender((n) => n + 1));
    void cache.prefetch(uri);
    return off;
  }, [uri]);
  return cache.get(uri)?.bleed ?? false;
}

/**
 * A company's colour (H44), read from the logo the viewer sees: the negative
 * artwork on dark grounds. A negative that lost the brand colours (white or
 * mono) has none, so the positive logo's colour is used instead.
 */
export function useCompanyLogoTint(
  logo: { logoUrl: string | null | undefined; logoNegativeUrl?: string | null } | null,
  dark: boolean,
): ReturnType<typeof useImageTint> {
  const negative =
    dark && logo?.logoNegativeUrl && logo.logoNegativeUrl !== logo.logoUrl
      ? logo.logoNegativeUrl
      : null;
  const shown = useImageTint(negative);
  const positive = useImageTint(logo?.logoUrl);
  if (!negative || shown.color) return negative ? shown : positive;
  return shown.settled ? positive : { color: null, settled: false, fromCache: false };
}
