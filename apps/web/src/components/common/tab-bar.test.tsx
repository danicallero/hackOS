import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { TabBar } from "./tab-bar";

function Harness({ value }: { value: string }) {
  return createElement(
    Tabs,
    { value },
    createElement(
      TabBar,
      { "aria-label": "Sections" },
      createElement(TabsTrigger, { value: "one" }, "One"),
      createElement(TabsTrigger, { value: "two" }, "Two"),
    ),
    createElement(TabsContent, { value: "one" }, "First panel"),
    createElement(TabsContent, { value: "two" }, "Second panel"),
  );
}

describe("TabBar active tab reveal and panel crossfade", () => {
  let container: HTMLDivElement;
  let root: Root;
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get: () => 400,
    });
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("scrolls the selected tab into view along the line and follows later changes", async () => {
    act(() => root.render(createElement(Harness, { value: "two" })));
    expect(scrollTo).toHaveBeenCalledWith({ left: 350, behavior: "auto" });

    scrollTo.mockClear();
    await act(async () => {
      root.render(createElement(Harness, { value: "one" }));
      await Promise.resolve();
    });
    expect(scrollTo).toHaveBeenCalled();
  });

  it("animates only the active panel with the shared reduced-motion rule", () => {
    act(() => root.render(createElement(Harness, { value: "one" })));
    const panel = container.querySelector<HTMLElement>('[role="tabpanel"]');
    expect(panel?.textContent).toBe("First panel");
    expect(panel?.className).toContain("data-[state=active]:animate-tab-panel-in");
  });
});
