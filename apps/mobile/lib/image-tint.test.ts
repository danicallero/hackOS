jest.mock("./directory", () => ({ apiImageSource: (uri: string) => ({ uri }) }));

import { createTintCache } from "./image-tint";

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
