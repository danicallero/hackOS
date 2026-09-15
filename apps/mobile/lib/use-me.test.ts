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
  getCurrentSessionCookie: jest.fn(() => "session=staff-a"),
}));

const mockCacheStore = new Map<string, { data: unknown; updatedAt: string }>();
jest.mock("./offline-cache", () => ({
  clearCachedValue: jest.fn(() => Promise.resolve()),
  clearCachedValues: jest.fn(() => Promise.resolve()),
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

import { ApiError, apiFetch, getCurrentSessionCookie } from "./api";
import { profileCacheKeyForSession, useMe } from "./use-me";

const mockApiFetch = apiFetch as jest.Mock;
const mockGetCookie = getCurrentSessionCookie as jest.Mock;

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
    mockGetCookie.mockReset().mockReturnValue("session=staff-a");
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
    // true here previously made the tab layout unmount its navigator, which
    // reset to its first tab (Schedule) on remount — a full navigation flicker
    // for a transient OS overlay that never backgrounded the app.
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

  it("coalesces concurrent profile refreshes into one request", async () => {
    const profileFetch = deferred<{ id: number; capabilities: string[] }>();
    mockApiFetch.mockReturnValue(profileFetch.promise);
    const { result } = await renderHook(() => useMe(true));

    const first = result.current.refetch();
    const second = result.current.refetch();
    expect(second).toBe(first);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      profileFetch.resolve({ id: 1, capabilities: [] });
      await first;
    });
    expect(result.current.me?.id).toBe(1);
  });

  it("preserves the canonical visibleRoleName field without a mobile role alias", async () => {
    mockApiFetch.mockResolvedValue({
      id: 1,
      capabilities: [],
      visibleRoleName: "Event staff",
    });

    const { result } = await renderHook(() => useMe(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me?.visibleRoleName).toBe("Event staff");
    expect(result.current.me).not.toHaveProperty("role");
  });
});

describe("useMe offline fallback", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockGetCookie.mockReset().mockReturnValue("session=staff-a");
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
    mockCacheStore.set(profileCacheKeyForSession("session=staff-a"), {
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
    mockCacheStore.set(profileCacheKeyForSession("session=staff-a"), {
      data: { id: 1, capabilities: [] },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    mockApiFetch.mockRejectedValue(new ApiError("api error", 401));

    const { result } = await renderHook(() => useMe(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toBeNull();
    expect(result.current.offline).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("pins a profile request to its session and ignores a delayed predecessor", async () => {
    const userAFetch = deferred<{ id: number; capabilities: string[] }>();
    const userBFetch = deferred<{ id: number; capabilities: string[] }>();
    mockApiFetch.mockReturnValueOnce(userAFetch.promise).mockReturnValueOnce(userBFetch.promise);
    const { result } = await renderHook(() => useMe(true));

    await act(async () => {
      result.current.clear();
      mockGetCookie.mockReturnValue("session=staff-b");
      const next = result.current.refetch();
      userBFetch.resolve({ id: 2, capabilities: [] });
      await next;
    });
    expect(result.current.me?.id).toBe(2);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/me",
      expect.objectContaining({
        sessionCookie: "session=staff-a",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/me",
      expect.objectContaining({
        sessionCookie: "session=staff-b",
        signal: expect.any(AbortSignal),
      }),
    );
    expect((mockApiFetch.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);

    await act(async () => {
      userAFetch.resolve({ id: 1, capabilities: [] });
      await userAFetch.promise;
    });
    expect(result.current.me?.id).toBe(2);
  });

  it("does not restore account A's offline profile under account B's session", async () => {
    mockCacheStore.set(profileCacheKeyForSession("session=staff-a"), {
      data: { id: 1, capabilities: [] },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    mockApiFetch.mockRejectedValue(new TypeError("Network request failed"));
    const { result } = await renderHook(() => useMe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me?.id).toBe(1);

    await act(async () => {
      result.current.clear();
      mockGetCookie.mockReturnValue("session=staff-b");
      await result.current.refetch();
    });
    expect(result.current.me).toBeNull();
    expect(result.current.offline).toBe(false);
  });
});
