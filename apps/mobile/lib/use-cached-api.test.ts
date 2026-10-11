import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

jest.mock("./offline-cache", () => ({
  readCachedValue: jest.fn(() => Promise.resolve(null)),
  writeCachedValue: jest.fn(() => Promise.resolve()),
}));
jest.mock("./use-retry-on-reconnect", () => ({
  useRetryOnReconnect: jest.fn(),
}));

import { readCachedValue, writeCachedValue } from "./offline-cache";
import { useCachedApi } from "./use-cached-api";

const mockReadCachedValue = readCachedValue as jest.Mock;
const mockWriteCachedValue = writeCachedValue as jest.Mock;

const listeners = new Set<(state: string) => void>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function emitAppState(nextState: string) {
  (AppState as { currentState: string }).currentState = nextState;
  for (const listener of listeners) listener(nextState);
}

describe("useCachedApi background recovery (H38, H51, H55)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockWriteCachedValue.mockClear();
    listeners.clear();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
      const listener = callback as (state: string) => void;
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    (AppState as { currentState: string }).currentState = "active";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("revalidates quietly after the app has been backgrounded long enough", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValue({ version: 2 });
    const { result } = await renderHook(() => useCachedApi("read-model", fetcher));
    await act(async () => result.current.load());

    expect(result.current.data).toEqual({ version: 1 });
    expect(result.current.loading).toBe(false);

    await act(async () => emitAppState("background"));
    await act(async () => {
      jest.advanceTimersByTime(60_001);
      emitAppState("active");
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.data).toEqual({ version: 2 });
    expect(result.current.loading).toBe(false);
  });

  it("does not refresh for a short inactive overlay", async () => {
    const fetcher = jest.fn().mockResolvedValue({ version: 1 });
    const { result } = await renderHook(() => useCachedApi("read-model", fetcher));
    await act(async () => result.current.load());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await act(async () => emitAppState("inactive"));
    await act(async () => {
      jest.advanceTimersByTime(1_000);
      emitAppState("active");
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("polls an event-backed read only while the app is active", async () => {
    const fetcher = jest.fn().mockResolvedValue({ version: 1 });
    const { result } = await renderHook(() =>
      useCachedApi("read-model", fetcher, { pollMs: 1_000 }),
    );
    await act(async () => result.current.load());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await act(async () => jest.advanceTimersByTime(1_000));
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => emitAppState("background"));
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("hides the predecessor cache while an account-scoped read switches owners", async () => {
    const first = deferred<{ version: number }>();
    const second = deferred<{ version: number }>();
    const signals: AbortSignal[] = [];
    const fetcher = jest.fn((signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const { result, rerender } = await renderHook(
      ({ cacheKey }: { cacheKey: string }) => useCachedApi(cacheKey, fetcher),
      { initialProps: { cacheKey: "user:1:notifications" } },
    );

    const firstLoad = result.current.load();
    await act(async () => rerender({ cacheKey: "user:2:notifications" }));
    expect(result.current.data).toBeNull();
    const secondLoad = result.current.load();
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      first.resolve({ version: 1 });
      await firstLoad;
      second.resolve({ version: 2 });
      await secondLoad;
    });

    expect(result.current.data).toEqual({ version: 2 });
    expect(writeCachedValue).toHaveBeenCalledWith(
      "user:2:notifications",
      { version: 2 },
      expect.any(String),
    );
    expect(writeCachedValue).not.toHaveBeenCalledWith(
      "user:1:notifications",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("useCachedApi cache-first reads (H28)", () => {
  afterEach(() => {
    mockReadCachedValue.mockReset();
    mockReadCachedValue.mockResolvedValue(null);
  });

  it("renders the persisted payload while the request is still pending", async () => {
    mockReadCachedValue.mockResolvedValue({
      data: { version: 1 },
      updatedAt: "2026-10-10T10:00:00.000Z",
    });
    const pending = deferred<{ version: number }>();
    const fetcher = jest.fn(() => pending.promise);
    const { result } = await renderHook(() =>
      useCachedApi("user:1:wallet", fetcher, { cacheFirst: true }),
    );

    await act(async () => {
      void result.current.load();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockReadCachedValue).toHaveBeenCalledWith("user:1:wallet");
    expect(result.current.data).toEqual({ version: 1 });
    expect(result.current.loading).toBe(false);
    expect(result.current.staleSince).toBeNull();

    await act(async () => pending.resolve({ version: 2 }));
    expect(result.current.data).toEqual({ version: 2 });
  });

  it("never lets a late cache read replace a fresher response", async () => {
    const cached = deferred<{ data: { version: number }; updatedAt: string } | null>();
    mockReadCachedValue.mockReturnValue(cached.promise);
    const fetcher = jest.fn().mockResolvedValue({ version: 2 });
    const { result } = await renderHook(() =>
      useCachedApi("user:1:wallet", fetcher, { cacheFirst: true }),
    );

    await act(async () => result.current.load());
    await act(async () =>
      cached.resolve({ data: { version: 1 }, updatedAt: "2026-10-10T10:00:00.000Z" }),
    );

    expect(result.current.data).toEqual({ version: 2 });
  });

  it("keeps the network-first default for other reads", async () => {
    mockReadCachedValue.mockResolvedValue({
      data: { version: 1 },
      updatedAt: "2026-10-10T10:00:00.000Z",
    });
    const fetcher = jest.fn(() => deferred<{ version: number }>().promise);
    const { result } = await renderHook(() => useCachedApi("read-model", fetcher));

    await act(async () => {
      void result.current.load();
    });

    expect(mockReadCachedValue).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});
