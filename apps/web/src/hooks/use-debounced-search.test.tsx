import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { useDebouncedSearch } from "./use-debounced-search";
import { useDebouncedValue } from "./use-debounced-value";
import { useNow } from "./use-now";

describe("debounce and clock hooks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("useDebouncedValue settles after the delay", () => {
    let seen = "";
    function Probe({ value }: { value: string }) {
      seen = useDebouncedValue(value, 300);
      return null;
    }
    act(() => root.render(<Probe value="a" />));
    act(() => root.render(<Probe value="ab" />));
    expect(seen).toBe("a");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(seen).toBe("ab");
  });

  it("useDebouncedSearch searches the settled query and aborts a superseded one", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (query: string, signal: AbortSignal) => {
      signals.push(signal);
      return [query];
    });
    let state: ReturnType<typeof useDebouncedSearch<string[]>> | undefined;
    function Probe({ query, enabled }: { query: string; enabled: boolean }) {
      state = useDebouncedSearch(query, fetcher, { enabled, delayMs: 200, minLength: 2 });
      return null;
    }
    act(() => root.render(<Probe query="a" enabled />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetcher).not.toHaveBeenCalled();

    act(() => root.render(<Probe query="ab" enabled />));
    act(() => root.render(<Probe query=" abc " enabled />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("abc");
    expect(state?.result).toEqual(["abc"]);

    act(() => root.render(<Probe query="abcd" enabled />));
    act(() => root.render(<Probe query="abcd" enabled={false} />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("useDebouncedSearch reports failure as an error", async () => {
    let state: ReturnType<typeof useDebouncedSearch<string[]>> | undefined;
    function Probe() {
      state = useDebouncedSearch("abc", () => Promise.reject(new Error("down")), { delayMs: 10 });
      return null;
    }
    act(() => root.render(<Probe />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(state).toMatchObject({ result: null, loading: false, error: true });
  });

  it("useNow ticks at the interval and stops when disabled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    let now = 0;
    function Probe({ interval }: { interval: number | null }) {
      now = useNow(interval);
      return null;
    }
    act(() => root.render(<Probe interval={1000} />));
    const start = now;
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(now - start).toBe(3000);
    act(() => root.render(<Probe interval={null} />));
    const frozen = now;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(now).toBe(frozen);
  });
});
