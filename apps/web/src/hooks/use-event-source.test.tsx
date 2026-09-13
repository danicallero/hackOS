import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveQuery } from "./use-event-source";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
}

const fetcher = vi.fn<() => Promise<{ version: number }>>();

function Harness() {
  useLiveQuery(fetcher, "/api/queue/stream", ["queue.changed"]);
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
    FakeEventSource.instances = [];
    fetcher.mockReset().mockResolvedValue({ version: 1 });
    vi.stubGlobal("EventSource", FakeEventSource);
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
    vi.unstubAllGlobals();
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
    await flush();
    expect(fetcher).toHaveBeenCalledOnce();

    const source = FakeEventSource.instances[0];
    act(() => source.onopen?.());
    Object.defineProperty(document, "visibilityState", { value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    vi.advanceTimersByTime(60_001);
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("polls the read model while the stream is disconnected", async () => {
    mount();
    await flush();
    const source = FakeEventSource.instances[0];
    act(() => {
      source.onopen?.();
      source.onerror?.();
    });

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
