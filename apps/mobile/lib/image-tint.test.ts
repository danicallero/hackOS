jest.mock("./directory", () => ({ apiImageSource: (uri: string) => ({ uri }) }));

import { createTintCache, pickDominantColor } from "./image-tint";

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
const repeat = (pixel: number[], n: number) => Array.from({ length: n }, () => pixel).flat();

describe("pickDominantColor", () => {
  it("returns a solid colour as is", () => {
    expect(pickDominantColor(repeat(px(51, 102, 204), 64))).toBe("#3366cc");
  });

  it("ignores transparent, near-white and near-black pixels", () => {
    const pixels = [
      ...repeat(px(255, 255, 255), 200),
      ...repeat(px(0, 0, 0), 200),
      ...repeat(px(200, 30, 30, 0), 200),
      ...repeat(px(51, 102, 204), 10),
    ];
    expect(pickDominantColor(pixels)).toBe("#3366cc");
  });

  it("prefers the larger and the more saturated bucket", () => {
    expect(
      pickDominantColor([...repeat(px(200, 30, 30), 30), ...repeat(px(30, 30, 200), 10)]),
    ).toBe("#c81e1e");
    // Equal size: the saturated blue beats the washed-out grey.
    expect(
      pickDominantColor([...repeat(px(130, 128, 126), 20), ...repeat(px(20, 60, 220), 20)]),
    ).toBe("#143cdc");
  });

  it("returns null without a usable pixel", () => {
    expect(pickDominantColor([])).toBeNull();
    expect(pickDominantColor(repeat(px(255, 255, 255), 50))).toBeNull();
  });
});

describe("tint cache", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("dedupes in-flight work and serves the cached colour synchronously", async () => {
    const decode = jest.fn(async () => "#112233");
    const cache = createTintCache(decode, (run) => run());
    expect(cache.get("a")).toBeUndefined();
    const [first, second] = [cache.prefetch("a"), cache.prefetch("a")];
    expect(await first).toBe("#112233");
    expect(await second).toBe("#112233");
    expect(decode).toHaveBeenCalledTimes(1);
    expect(cache.get("a")).toBe("#112233");
    await cache.prefetch("a");
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("caches a failed decode as no colour and never rejects", async () => {
    const cache = createTintCache(
      async () => Promise.reject(new Error("boom")),
      (run) => run(),
    );
    expect(await cache.prefetch("bad")).toBeNull();
    expect(cache.get("bad")).toBeNull();
  });

  it("runs at most two decodes at once", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const decode = () =>
      new Promise<string | null>((resolve) => {
        active += 1;
        peak = Math.max(peak, active);
        releases.push(() => {
          active -= 1;
          resolve("#010203");
        });
      });
    const cache = createTintCache(decode, (run) => run());
    const all = ["a", "b", "c", "d"].map((uri) => cache.prefetch(uri));
    expect(releases).toHaveLength(2);
    while (releases.length > 0) {
      (releases.shift() as () => void)();
      await flush();
    }
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(cache.get("d")).toBe("#010203");
  });

  it("notifies subscribers once the colour is ready", async () => {
    const cache = createTintCache(
      async () => "#abcdef",
      (run) => run(),
    );
    const listener = jest.fn();
    cache.subscribe("a", listener);
    await cache.prefetch("a");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores empty urls", () => {
    const cache = createTintCache(jest.fn(), (run) => run());
    expect(cache.prefetch(null)).toBeNull();
    expect(cache.get(undefined)).toBeNull();
  });
});
