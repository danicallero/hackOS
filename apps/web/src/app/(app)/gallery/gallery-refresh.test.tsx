import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GalleryRefresh } from "./gallery-refresh";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/hooks/use-event-source", () => ({ useEventSource: mocks.subscribe }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it("coalesces public signals and rechecks clock boundaries without navigating", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(<GalleryRefresh />));
  const [scope, options] = mocks.subscribe.mock.calls[0];
  expect(scope).toBe(REALTIME_SCOPES.PUBLIC_CONTENT);
  expect(options.events).toEqual([EVENTS.DATA_CHANGED]);
  act(() => {
    options.onEvent();
    options.onEvent();
    options.onResync();
    vi.advanceTimersByTime(200);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(15_000));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  await act(async () => root?.unmount());
  root = null;
  act(() => vi.advanceTimersByTime(30_000));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("recovers a cancelled debounce after rerender and polls only visible pages", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(<GalleryRefresh />));
  act(() => mocks.subscribe.mock.calls.at(-1)?.[1].onEvent());
  await act(async () => root?.render(<GalleryRefresh />));
  act(() => {
    mocks.subscribe.mock.calls.at(-1)?.[1].onEvent();
    vi.advanceTimersByTime(200);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(30_000));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(200);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});
