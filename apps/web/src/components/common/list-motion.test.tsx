import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateSwap } from "./list-motion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function reduced(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

describe("StateSwap", () => {
  let container: HTMLDivElement;
  let root: Root;
  let flip: () => void = () => {};

  function Harness() {
    const [state, setState] = useState("a");
    flip = () => setState("b");
    return (
      <StateSwap stateKey={state}>
        {state === "a" ? <button type="button">A</button> : "B"}
      </StateSwap>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("keeps the previous state as an inert, hidden layer while it fades out", () => {
    reduced(false);
    act(() => root.render(<Harness />));
    act(() => flip());
    const leaving = container.querySelector(".list-swap-out");
    expect(leaving?.getAttribute("aria-hidden")).toBe("true");
    expect(leaving?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".list-swap-in")?.textContent).toBe("B");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container.querySelector(".list-swap-out")).toBeNull();
  });

  it("swaps without any layer under reduced motion", () => {
    reduced(true);
    act(() => root.render(<Harness />));
    act(() => flip());
    expect(container.querySelector(".list-swap-out")).toBeNull();
    expect(container.textContent).toBe("B");
  });
});
