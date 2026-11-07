import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("tooltip timing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Hint text</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const hasTip = () => document.querySelector('[data-slot="tooltip-content"]') !== null;

  it("waits about 500 ms before opening on pointer hover", () => {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
      vi.advanceTimersByTime(300);
    });
    expect(hasTip()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(hasTip()).toBe(true);
  });

  it("opens immediately on keyboard focus", () => {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => {
      trigger.focus();
    });
    expect(hasTip()).toBe(true);
  });
});
