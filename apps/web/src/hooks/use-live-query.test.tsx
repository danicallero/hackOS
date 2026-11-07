import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const stream = vi.hoisted(() => ({ onEvent: undefined as undefined | ((e: unknown) => void) }));
vi.mock("./use-event-source", () => ({
  useEventSource: (_scope: string, opts: { onEvent: (e: unknown) => void }) => {
    stream.onEvent = opts.onEvent;
    return { connected: true };
  },
}));

import { ApiError } from "@/lib/api";
import { resetServerStateForTests } from "@/lib/server-state";
import { useLiveQuery } from "./use-live-query";

type Result = ReturnType<typeof useLiveQuery<{ n: number }>>;

describe("useLiveQuery stale data (#1012)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: Result;
  const fetcher = vi.fn<() => Promise<{ n: number }>>();

  function Harness() {
    result = useLiveQuery(fetcher, "scope", ["changed"], { resourceKey: ["stale-test"] });
    return null;
  }

  async function settle(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function mountLoaded() {
    fetcher.mockResolvedValueOnce({ n: 1 });
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    expect(result.data).toEqual({ n: 1 });
  }

  async function emitEvent() {
    await act(async () => {
      stream.onEvent?.({});
    });
    await settle(200);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetServerStateForTests();
    fetcher.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("keeps the data, flips stale on, and backs off until a read succeeds", async () => {
    await mountLoaded();
    const rateLimited = new ApiError(429, "rate_limited", "Slow down");

    fetcher.mockRejectedValueOnce(rateLimited);
    await emitEvent();
    expect(result.data).toEqual({ n: 1 });
    expect(result.stale).toBe(true);
    expect(result.error).toBeNull();

    // First retry after 5 s fails again; the next waits 10 s.
    fetcher.mockRejectedValueOnce(rateLimited);
    await settle(5_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValueOnce({ n: 2 });
    await settle(9_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await settle(1_000);
    expect(fetcher).toHaveBeenCalledTimes(4);

    expect(result.data).toEqual({ n: 2 });
    expect(result.stale).toBe(false);
    expect(result.error).toBeNull();
  });

  it("surfaces a 404 over loaded data and does not retry it", async () => {
    await mountLoaded();
    fetcher.mockRejectedValueOnce(new ApiError(404, "not_found", "gone"));
    await emitEvent();
    expect(result.error).toBeInstanceOf(ApiError);
    expect(result.stale).toBe(false);
    await settle(60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports a failed first read as an error, not as stale", async () => {
    fetcher.mockRejectedValueOnce(new ApiError(500, "boom", "boom"));
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(ApiError);
    expect(result.stale).toBe(false);
  });
});
