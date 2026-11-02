import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { useResponseSelection } from "./use-response-selection";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

it("keeps selection stable and avoids same-value history writes under rerenders (H13)", () => {
  window.history.replaceState(null, "", "/applications/1?tab=review&response=10");
  const replace = vi.spyOn(window.history, "replaceState");
  const container = document.createElement("div");
  const root = createRoot(container);
  let latest!: ReturnType<typeof useResponseSelection>;
  function Harness() {
    latest = useResponseSelection();
    return createElement("output", null, latest.selectedId);
  }
  act(() => root.render(createElement(Harness)));
  const setter = latest.setSelectedId;
  expect(latest.selectedId).toBe(10);
  act(() => latest.setSelectedId(10));
  act(() => root.render(createElement(Harness)));
  expect(latest.setSelectedId).toBe(setter);
  expect(replace).not.toHaveBeenCalled();
  act(() => latest.setSelectedId(11));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe("?tab=review&response=11");
  act(() => root.render(createElement(Harness)));
  expect(latest.selectedId).toBe(11);
  act(() => latest.setSelectedId(null));
  expect(window.location.search).toBe("?tab=review");
  act(() => latest.setSelectedId(null));
  expect(replace).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
});
