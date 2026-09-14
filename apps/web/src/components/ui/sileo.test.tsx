import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster, sileo, type SileoOptions } from "sileo";

describe("Sileo toaster timing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Toaster position="top-right" theme="dark" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    sileo.clear();
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not restart an existing toast when a new toast arrives", () => {
    act(() =>
      sileo.success({ id: "first-toast", title: "First", duration: 1_000 } as SileoOptions & {
        id: string;
      }),
    );
    act(() => vi.advanceTimersByTime(600));
    act(() =>
      sileo.success({ id: "second-toast", title: "Second", duration: 1_000 } as SileoOptions & {
        id: string;
      }),
    );
    act(() => vi.advanceTimersByTime(450));

    const first = Array.from(host.querySelectorAll<HTMLElement>("[data-sileo-toast]")).find(
      (toast) => toast.textContent?.includes("First"),
    );
    const second = Array.from(host.querySelectorAll<HTMLElement>("[data-sileo-toast]")).find(
      (toast) => toast.textContent?.includes("Second"),
    );

    expect(first?.dataset.exiting).toBe("true");
    expect(second?.dataset.exiting).not.toBe("true");
  });
});
