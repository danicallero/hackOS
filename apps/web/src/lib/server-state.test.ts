import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invalidateServerState,
  readServerState,
  resetServerStateForTests,
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
});
