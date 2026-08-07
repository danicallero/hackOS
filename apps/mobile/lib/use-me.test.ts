import { act, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

jest.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  apiFetch: jest.fn(),
}));

const mockCacheStore = new Map<string, { data: unknown; updatedAt: string }>();
jest.mock("./offline-cache", () => ({
  readCachedValue: jest.fn((key: string) => Promise.resolve(mockCacheStore.get(key) ?? null)),
  writeCachedValue: jest.fn(
    (key: string, data: unknown, updatedAt = "2026-01-01T00:00:00.000Z") => {
      mockCacheStore.set(key, { data, updatedAt });
      return Promise.resolve();
    },
  ),
}));

jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: () => {} })),
}));

import { ApiError, apiFetch } from "./api";
import { useMe } from "./use-me";

const mockApiFetch = apiFetch as jest.Mock;

// Real AppState is backed by a native module the test environment can't
// drive directly, so intercept just `addEventListener` to fire the exact
// `inactive -> active` sequence iOS emits when Control Center (or
// Notification Center, or the app switcher) briefly covers the app.
let listeners: Set<(state: string) => void>;

function emitAppState(nextState: string) {
  (AppState as { currentState: string }).currentState = nextState;
  for (const listener of listeners) listener(nextState);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useMe foreground revalidation (H55)", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockCacheStore.clear();
    listeners = new Set();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => {
      const listener = cb as (state: string) => void;
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    (AppState as { currentState: string }).currentState = "active";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps loading false while revalidating an already-loaded profile in the background", async () => {
    const initialFetch = deferred<{ id: number; capabilities: string[] }>();
    mockApiFetch.mockReturnValueOnce(initialFetch.promise);
    const { result } = await renderHook(() => useMe(true));

    expect(result.current.loading).toBe(true);
    await act(async () => {
      initialFetch.resolve({ id: 1, capabilities: [] });
      await initialFetch.promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.me).not.toBeNull();

    // Opening then closing iOS Control Center flips AppState through
    // `inactive` and back to `active` without ever backgrounding the app,
    // which triggers useMe's foreground revalidation.
    const revalidateFetch = deferred<{ id: number; capabilities: string[] }>();
    mockApiFetch.mockReturnValueOnce(revalidateFetch.promise);
    await act(async () => emitAppState("inactive"));
    await act(async () => emitAppState("active"));

    // This is the bug this test guards against: `loading` flipping back to
    // true here previously made the tab layout unmount `NativeTabs`, which
    // reset to its first tab (Schedule) on remount — a full navigation
    // flicker for a transient OS overlay that never backgrounded the app.
    expect(result.current.loading).toBe(false);
    expect(result.current.me).not.toBeNull();

    await act(async () => {
      revalidateFetch.resolve({ id: 1, capabilities: [] });
      await revalidateFetch.promise;
    });
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
  });

  it("still shows a loading state for the very first fetch", async () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useMe(true));
    expect(result.current.loading).toBe(true);
    expect(result.current.me).toBeNull();
  });
});

describe("useMe offline fallback", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockCacheStore.clear();
    listeners = new Set();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, cb) => {
      const listener = cb as (state: string) => void;
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    (AppState as { currentState: string }).currentState = "active";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves the last cached profile when the live fetch can't reach the server", async () => {
    mockCacheStore.set("me", {
      data: { id: 1, capabilities: ["accredit:scan"] },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    mockApiFetch.mockRejectedValue(new TypeError("Network request failed"));

    const { result } = await renderHook(() => useMe(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toEqual({ id: 1, capabilities: ["accredit:scan"] });
    expect(result.current.offline).toBe(true);
    expect(result.current.staleSince).toBe("2025-12-01T00:00:00.000Z");
  });

  it("leaves the app stuck on an error, not a stale profile, when nothing was ever cached", async () => {
    mockApiFetch.mockRejectedValue(new TypeError("Network request failed"));

    const { result } = await renderHook(() => useMe(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  it("clears the cached profile on a confirmed 401 instead of falling back to it", async () => {
    mockCacheStore.set("me", {
      data: { id: 1, capabilities: [] },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    mockApiFetch.mockRejectedValue(new ApiError("api error", 401));

    const { result } = await renderHook(() => useMe(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toBeNull();
    expect(result.current.offline).toBe(false);
  });
});
