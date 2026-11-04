import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateServerState,
  peekServerState,
  readServerState,
  resetServerStateForTests,
  revalidateServerState,
  setServerStateIdentity,
} from "./server-state";

afterEach(resetServerStateForTests);

describe("browser server state (#720)", () => {
  it("coalesces concurrent reads for one identity and resource", async () => {
    setServerStateIdentity(7);
    const fetcher = vi.fn(async () => ({ version: 1 }));

    await expect(
      Promise.all([
        readServerState(["judging", "room-view", 3], fetcher),
        readServerState(["judging", "room-view", 3], fetcher),
      ]),
    ).resolves.toEqual([{ version: 1 }, { version: 1 }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("aborts and never retains a response from a replaced identity", async () => {
    setServerStateIdentity(7);
    let resolveOld!: (value: { owner: number }) => void;
    const old = readServerState(
      ["permissions", "roles"],
      (signal) =>
        new Promise((resolve) => {
          resolveOld = resolve;
          signal.addEventListener("abort", () => undefined);
        }),
    );

    setServerStateIdentity(8);
    resolveOld({ owner: 7 });
    await expect(old).resolves.toEqual({ owner: 7 });

    const current = vi.fn(async () => ({ owner: 8 }));
    await expect(readServerState(["permissions", "roles"], current)).resolves.toEqual({ owner: 8 });
    expect(current).toHaveBeenCalledOnce();
  });

  it("aborts an invalidated request and refetches the exact resource", async () => {
    setServerStateIdentity(7);
    const aborted = vi.fn();
    void readServerState(
      ["judging", "room-view", 3],
      (signal) => new Promise<never>(() => signal.addEventListener("abort", aborted)),
    );
    invalidateServerState(["judging", "room-view", 3]);
    expect(aborted).toHaveBeenCalledOnce();

    const fresh = vi.fn(async () => ({ version: 2 }));
    await expect(readServerState(["judging", "room-view", 3], fresh)).resolves.toEqual({
      version: 2,
    });
    expect(fresh).toHaveBeenCalledOnce();
  });

  describe("stale-while-revalidate", () => {
    it("peeks settled data past the TTL and never starts a request", async () => {
      vi.useFakeTimers();
      try {
        setServerStateIdentity(7);
        const key = ["challenges", "all"];
        expect(peekServerState(key)).toBeUndefined();
        await readServerState(key, async () => ["a"]);
        vi.advanceTimersByTime(60_000);
        expect(peekServerState(key)).toEqual(["a"]);

        const refetch = vi.fn(async () => ["b"]);
        await expect(readServerState(key, refetch)).resolves.toEqual(["b"]);
        expect(refetch).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(6 * 60_000);
        expect(peekServerState(key)).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the previous value peekable while revalidating, then replaces it", async () => {
      setServerStateIdentity(7);
      const key = ["enterprises"];
      await readServerState(key, async () => ["old"]);
      let resolve!: (v: string[]) => void;
      const pending = revalidateServerState(key, () => new Promise<string[]>((r) => (resolve = r)));
      expect(peekServerState(key)).toEqual(["old"]);
      resolve(["new"]);
      await pending;
      expect(peekServerState(key)).toEqual(["new"]);
    });

    it("revalidate bypasses a fresh value but joins an in-flight read", async () => {
      setServerStateIdentity(7);
      const key = ["users", ""];
      await readServerState(key, async () => 1);
      const fetcher = vi.fn(async () => 2);
      await Promise.all([revalidateServerState(key, fetcher), revalidateServerState(key, fetcher)]);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(peekServerState(key)).toBe(2);
    });

    it("drops peekable data on invalidation and identity change", async () => {
      setServerStateIdentity(7);
      const key = ["applications"];
      await readServerState(key, async () => "x");
      invalidateServerState(key);
      expect(peekServerState(key)).toBeUndefined();
      await readServerState(key, async () => "y");
      setServerStateIdentity(8);
      expect(peekServerState(key)).toBeUndefined();
    });
  });
});
