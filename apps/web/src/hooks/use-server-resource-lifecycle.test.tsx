import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerStateForTests, setServerStateIdentity } from "@/lib/server-state";
import { useServerResource } from "./use-server-resource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useServerResource lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let latest: ReturnType<typeof useServerResource<string>>;
  let firstLoading: boolean | undefined;

  function Probe({
    id,
    fetcher,
    revision = 0,
  }: {
    id: string;
    fetcher: (signal: AbortSignal) => Promise<string>;
    revision?: number;
  }) {
    latest = useServerResource(["resource-hook-test", id], fetcher);
    firstLoading ??= latest.loading;
    return <span>{revision}</span>;
  }

  const render = (props: Parameters<typeof Probe>[0]) =>
    act(async () => {
      root?.render(<Probe {...props} />);
    });

  beforeEach(() => {
    resetServerStateForTests();
    setServerStateIdentity(1);
    container = document.createElement("div");
    root = createRoot(container);
    firstLoading = undefined;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    resetServerStateForTests();
    vi.restoreAllMocks();
  });

  it("starts loading and publishes the first response", async () => {
    const request = deferred<string>();
    await render({ id: "initial", fetcher: () => request.promise });

    expect(firstLoading).toBe(true);
    expect(latest.loading).toBe(true);
    expect(latest.data).toBeNull();

    await act(async () => request.resolve("loaded"));
    expect(latest.data).toBe("loaded");
    expect(latest.error).toBeNull();
    expect(latest.loading).toBe(false);
  });

  it("exposes a cold-load error", async () => {
    const failure = new Error("offline");
    await render({ id: "error", fetcher: () => Promise.reject(failure) });

    expect(latest.data).toBeNull();
    expect(latest.error).toBe(failure);
    expect(latest.loading).toBe(false);
  });

  it("reloads and keeps the reload callback stable across renders", async () => {
    const fetcher = vi.fn<(_: AbortSignal) => Promise<string>>();
    fetcher.mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    await render({ id: "reload", fetcher });
    expect(latest.data).toBe("first");

    const reload = latest.reload;
    await render({ id: "reload", fetcher, revision: 1 });
    expect(latest.reload).toBe(reload);

    await act(async () => latest.reload());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(latest.data).toBe("second");
    expect(latest.loading).toBe(false);
  });

  it("returns to loading when retrying a failed first read", async () => {
    const retry = deferred<string>();
    const fetcher = vi
      .fn<(_: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => retry.promise);
    await render({ id: "retry", fetcher });
    expect(latest.error).toBeInstanceOf(Error);

    await act(async () => latest.reload());
    expect(latest.loading).toBe(true);
    expect(latest.error).toBeNull();

    await act(async () => retry.resolve("recovered"));
    expect(latest.data).toBe("recovered");
    expect(latest.loading).toBe(false);
  });

  it("ignores a slower response after the resource key changes", async () => {
    const oldRequest = deferred<string>();
    const newRequest = deferred<string>();
    await render({ id: "old", fetcher: () => oldRequest.promise });
    await render({ id: "new", fetcher: () => newRequest.promise });

    await act(async () => newRequest.resolve("new data"));
    expect(latest.data).toBe("new data");

    await act(async () => oldRequest.resolve("old data"));
    expect(latest.data).toBe("new data");
  });

  it("ignores a response that arrives after unmount", async () => {
    const request = deferred<string>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await render({ id: "unmount", fetcher: () => request.promise });
    act(() => {
      root?.unmount();
      root = null;
    });

    await act(async () => request.resolve("late data"));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
