import { domainScope, EVENTS, REALTIME_SCOPES, SSE_TOPICS } from "@hackos/shared/events";
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

it("listens to the gallery streams and refreshes once, jittered, without polling", async () => {
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(<GalleryRefresh />));
  const scopes = mocks.subscribe.mock.calls.map(([scope]) => scope);
  expect(scopes).toEqual([
    REALTIME_SCOPES.PUBLIC_CONTENT,
    domainScope(SSE_TOPICS.PROJECTS),
    domainScope(SSE_TOPICS.DIRECTORY),
  ]);
  expect(mocks.subscribe.mock.calls[0]?.[1].events).toEqual([EVENTS.DATA_CHANGED]);
  expect(mocks.subscribe.mock.calls[1]?.[1].events).toEqual([EVENTS.DOMAIN_CHANGED]);
  // A burst across streams coalesces into one refresh inside the jitter window.
  act(() => {
    mocks.subscribe.mock.calls[0]?.[1].onEvent();
    mocks.subscribe.mock.calls[1]?.[1].onEvent();
    mocks.subscribe.mock.calls[2]?.[1].onResync();
    vi.advanceTimersByTime(3_000);
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  // No timer-driven refresh without a signal.
  act(() => vi.advanceTimersByTime(10 * 60_000));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("cancels a pending refresh on unmount", async () => {
  vi.useFakeTimers();
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(<GalleryRefresh />));
  act(() => mocks.subscribe.mock.calls[0]?.[1].onEvent());
  await act(async () => root?.unmount());
  root = null;
  act(() => vi.advanceTimersByTime(10_000));
  expect(mocks.refresh).not.toHaveBeenCalled();
});
