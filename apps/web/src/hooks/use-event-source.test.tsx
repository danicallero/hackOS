import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerStateForTests } from "@/lib/server-state";
import { setSseIdentity } from "@/lib/sse-broker";
import { mockRealtimeFetch } from "@/lib/sse-test-fixture";
import { useLiveQuery } from "./use-event-source";

let fixture: ReturnType<typeof mockRealtimeFetch>;

const fetcher = vi.fn<() => Promise<{ version: number }>>();

function Harness() {
  useLiveQuery(fetcher, "queue", ["queue.changed"], {
    resourceKey: ["test", "queue"],
  });
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useLiveQuery recovery (H38, H41-H42)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    resetServerStateForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
    setSseIdentity(101, "http://localhost:3000");
    fixture = mockRealtimeFetch();
    fetcher.mockReset().mockResolvedValue({ version: 1 });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    setSseIdentity(null, "http://localhost:3000");
    vi.unstubAllGlobals();
    resetServerStateForTests();
    vi.useRealTimers();
  });

  function mount() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Harness)));
  }

  it("revalidates when a visible tab returns after a long background", async () => {
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flush();
    expect(fetcher).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", { value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    vi.advanceTimersByTime(60_001);
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("polls the read model while the stream is disconnected", async () => {
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flush();
    const source = fixture.connections[0];
    fixture.fetcher.mockResolvedValue({
      ok: false,
      status: 503,
      body: null as never,
      headers: new Headers(),
    });
    await act(async () => source.end());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("turns an SSE burst into one invalidation and one trailing read", async () => {
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flush();
    const source = fixture.connections[0];
    source.emit("queue", 1, "queue.changed");
    source.emit("queue", 2, "queue.changed");
    source.emit("queue", 3, "queue.changed");

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(150);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("paints the previous read model on remount without a loading state, then revalidates", async () => {
    let seen: { data: { version: number } | null; loading: boolean }[] = [];
    function Probe() {
      const { data, loading } = useLiveQuery(fetcher, "queue", ["queue.changed"], {
        resourceKey: ["test", "queue"],
      });
      seen.push({ data, loading });
      return null;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));
    await flush();
    expect(seen[0]).toEqual({ data: null, loading: true });

    act(() => root?.unmount());
    vi.setSystemTime(new Date("2026-09-14T10:01:00.000Z"));
    fetcher.mockResolvedValue({ version: 2 });
    seen = [];
    root = createRoot(container);
    act(() => root?.render(createElement(Probe)));
    expect(seen[0]).toEqual({ data: { version: 1 }, loading: false });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual({ data: { version: 2 }, loading: false });
    expect(seen.some((s) => s.loading)).toBe(false);
  });
});
