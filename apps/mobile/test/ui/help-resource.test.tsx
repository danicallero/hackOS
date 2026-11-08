import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockFetch = jest.fn();
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => unknown) => require("react").useEffect(cb, [cb]),
}));
jest.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => mockFetch(...a) }));
jest.mock("@/lib/notification-events", () => ({ subscribeToNotificationChanges: () => () => {} }));
jest.mock("@/lib/server-events", () => ({
  startDomainEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));

import { useHelpResource } from "@/lib/use-help-resource";

afterEach(() => mockFetch.mockReset());

describe("useHelpResource lifecycle", () => {
  it("loads data and stops loading", async () => {
    mockFetch.mockResolvedValue({ helpers: [] });
    const { result } = await renderHook(() => useHelpResource<{ helpers: unknown[] }>("/x"));
    await waitFor(() => expect(result.current.data).toEqual({ helpers: [] }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failure as a retryable error, not a spinner", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    const { result } = await renderHook(() => useHelpResource("/x"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.loading).toBe(false);
    mockFetch.mockResolvedValue({ ok: 1 });
    await act(() => result.current.load());
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ ok: 1 });
  });

  it("passes a time-limited abort signal; an aborted request lands in the error state", async () => {
    let signal: AbortSignal | undefined;
    mockFetch.mockImplementation(
      (_p: string, init: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = init.signal;
          init.signal.addEventListener("abort", () => reject(new Error("timeout")));
        }),
    );
    const { result } = await renderHook(() => useHelpResource("/x"));
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    expect(result.current.loading).toBe(true);
    expect(signal?.aborted).toBe(false);
    // Fire the same abort the 20 s timer would, without waiting for it.
    (signal as AbortSignal & { dispatchEvent: (e: Event) => boolean }).dispatchEvent(
      new Event("abort"),
    );
    await waitFor(() => expect(result.current.error?.message).toBe("timeout"));
    expect(result.current.loading).toBe(false);
  });

  it("a null path never fetches", async () => {
    await renderHook(() => useHelpResource(null));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
