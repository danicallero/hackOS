import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { resolveUrlTab, useUrlTab } from "./url-tab";

const values = ["overview", "activity"] as const;

describe("resolveUrlTab (UX-03)", () => {
  it("keeps a valid deep-linked tab", () => {
    expect(resolveUrlTab("activity", { values, defaultValue: "overview" })).toBe("activity");
  });

  it("falls back safely for an unknown value", () => {
    expect(resolveUrlTab("broken", { values, defaultValue: "overview" })).toBe("overview");
  });

  it("maps legacy deep links to the grouped view", () => {
    expect(
      resolveUrlTab("presence", {
        values,
        defaultValue: "overview",
        aliases: { presence: "activity" },
      }),
    ).toBe("activity");
  });
});

describe("useUrlTab URL behavior (UX-03)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: { tab: (typeof values)[number]; setTab: (next: string) => void } | null;

  function Harness() {
    const state = useUrlTab({ values, defaultValue: "overview" });
    useEffect(() => {
      latest = state;
    }, [state]);
    return createElement("output", { "data-tab": state.tab });
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/demo");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    latest = null;
  });

  it("reads a direct link and falls back for an invalid URL value", () => {
    window.history.replaceState(null, "", "/demo?tab=activity");
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("activity");

    window.history.replaceState(null, "", "/demo?tab=unknown");
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("overview");
  });

  it("writes the selected tab without dropping other query parameters", () => {
    window.history.replaceState(null, "", "/demo?filter=open&tab=overview#panel");
    act(() => root.render(createElement(Harness)));
    act(() => latest?.setTab("activity"));
    expect(window.location.href).toContain("/demo?filter=open&tab=activity#panel");
  });

  it("does not replace history when the canonical tab is already selected", () => {
    window.history.replaceState(null, "", "/demo?filter=open&tab=overview");
    act(() => root.render(createElement(Harness)));
    const replaceState = vi.spyOn(window.history, "replaceState");
    try {
      act(() => latest?.setTab("overview"));
      expect(replaceState).not.toHaveBeenCalled();
    } finally {
      replaceState.mockRestore();
    }
  });

  it("keeps the setter stable across parent rerenders", () => {
    act(() => root.render(createElement(Harness)));
    const firstSetter = latest?.setTab;
    act(() => root.render(createElement(Harness)));
    expect(latest?.setTab).toBe(firstSetter);
  });

  it("tracks a back/forward-style URL change on rerender", () => {
    window.history.replaceState(null, "", "/demo?tab=overview");
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("overview");

    window.history.replaceState(null, "", "/demo?tab=activity");
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("activity");
  });
});
