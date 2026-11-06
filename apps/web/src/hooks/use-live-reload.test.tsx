import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveReload } from "./use-live-reload";

const stream = vi.hoisted(() => ({
  onEvent: () => {},
  options: null as null | { enabled?: boolean; events?: readonly string[] },
}));

vi.mock("./use-event-source", () => ({
  useEventSource: (
    _scope: string,
    options: { onEvent: () => void; enabled?: boolean; events?: readonly string[] },
  ) => {
    stream.onEvent = options.onEvent;
    stream.options = options;
    return { connected: true };
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const reload = vi.fn();
function Harness({ enabled = true }: { enabled?: boolean }) {
  useLiveReload("domain:test", ["domain.changed"], reload, { enabled });
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useLiveReload", () => {
  it("coalesces a burst of events into one reload", () => {
    act(() => root.render(<Harness />));
    expect(stream.options?.events).toEqual(["domain.changed"]);
    stream.onEvent();
    stream.onEvent();
    stream.onEvent();
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(reload).toHaveBeenCalledTimes(1);
    stream.onEvent();
    act(() => vi.advanceTimersByTime(250));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("passes enabled through and drops a pending reload on unmount", () => {
    act(() => root.render(<Harness enabled={false} />));
    expect(stream.options?.enabled).toBe(false);
    act(() => root.render(<Harness />));
    stream.onEvent();
    act(() => root.unmount());
    act(() => vi.advanceTimersByTime(250));
    expect(reload).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
