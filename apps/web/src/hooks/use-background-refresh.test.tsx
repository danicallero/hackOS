import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { ApiError } from "@/lib/api";
import { isNotFoundError, useBackgroundRefresh } from "./use-background-refresh";

type Hook = ReturnType<typeof useBackgroundRefresh>;

describe("useBackgroundRefresh (#1012)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: Hook;

  function Probe() {
    hook = useBackgroundRefresh();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("reports a failure before any success as a first-load failure", () => {
    let shown = false;
    act(() => {
      shown = hook.failed(new ApiError(429, "rate_limited", "slow down"));
    });
    expect(shown).toBe(true);
    expect(hook.stale).toBe(false);
  });

  it("absorbs a failure after a success as stale and retries with backoff", () => {
    act(() => hook.succeeded());
    const first = hook.retryNonce;
    let shown = true;
    act(() => {
      shown = hook.failed(new ApiError(429, "rate_limited", "slow down"));
    });
    expect(shown).toBe(false);
    expect(hook.stale).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(hook.retryNonce).toBe(first + 1);

    act(() => {
      hook.failed(new Error("network"));
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(hook.retryNonce).toBe(first + 1);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(hook.retryNonce).toBe(first + 2);
  });

  it("clears stale and cancels the retry on the next success", () => {
    act(() => hook.succeeded());
    act(() => {
      hook.failed(new Error("network"));
    });
    act(() => hook.succeeded());
    expect(hook.stale).toBe(false);
    const nonce = hook.retryNonce;
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(hook.retryNonce).toBe(nonce);
  });

  it("treats a 404 as definitive even after a success", () => {
    act(() => hook.succeeded());
    let shown = false;
    act(() => {
      shown = hook.failed(new ApiError(404, "not_found", "gone"));
    });
    expect(shown).toBe(true);
    expect(isNotFoundError(new ApiError(404, "not_found", "gone"))).toBe(true);
    expect(isNotFoundError(new ApiError(429, "rate_limited", "slow"))).toBe(false);
  });

  it("forgets the loaded state on reset", () => {
    act(() => hook.succeeded());
    act(() => hook.reset());
    let shown = false;
    act(() => {
      shown = hook.failed(new Error("network"));
    });
    expect(shown).toBe(true);
  });
});
