import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/demo", query: "" }));
const routerReplace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(navigation.query),
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
    navigation.pathname = "/demo";
    navigation.query = "";
    routerReplace.mockClear();
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
    navigation.query = "tab=activity";
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("activity");

    navigation.query = "tab=unknown";
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("overview");
  });

  it("writes the selected tab without dropping other query parameters", () => {
    navigation.query = "filter=open&tab=overview";
    act(() => root.render(createElement(Harness)));
    act(() => latest?.setTab("activity"));
    expect(routerReplace).toHaveBeenCalledWith("/demo?filter=open&tab=activity", {
      scroll: false,
    });
  });

  it("tracks a back/forward-style URL change on rerender", () => {
    navigation.query = "tab=overview";
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("overview");

    navigation.query = "tab=activity";
    act(() => root.render(createElement(Harness)));
    expect(container.querySelector("output")?.dataset.tab).toBe("activity");
  });
});
