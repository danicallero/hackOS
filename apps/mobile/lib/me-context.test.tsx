import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { getViewedEdition, resetViewedEdition } from "./edition";

const mockMe = { id: 7, eventTimezone: "Europe/Madrid" };
const mockRefetch = jest.fn();
const mockApiFetch = jest.fn();
const mockHandlers = new Map<string, { callback: () => void; scope: string }>();
const mockStopStream = jest.fn();

jest.mock("./use-me", () => ({
  useMe: () => ({
    me: mockMe,
    authenticated: true,
    loading: false,
    error: null,
    offline: false,
    staleSince: null,
    offlineEntryAvailable: false,
    enterOffline: jest.fn(),
    refetch: mockRefetch,
    clear: jest.fn(),
  }),
}));
jest.mock("./api", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock("./offline-cache", () => ({ clearCachedValues: jest.fn(async () => undefined) }));
jest.mock("./event-time", () => ({ setEventTimeZone: jest.fn() }));
jest.mock("./sign-out-events", () => ({ registerSignOutListener: () => () => undefined }));
jest.mock("./server-events", () => ({
  setServerEventIdentity: jest.fn(),
  startDomainEventStream: jest.fn(() => mockStopStream),
  subscribeToServerEvent: (type: string, callback: () => void, scope: string) => {
    mockHandlers.set(type, { callback, scope });
    return () => mockHandlers.delete(type);
  },
}));

import { MeProvider, useMeContext } from "./me-context";

const wrapper = ({ children }: { children: ReactNode }) => <MeProvider>{children}</MeProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockHandlers.clear();
  mockRefetch.mockResolvedValue(mockMe);
  mockApiFetch.mockImplementation(async (path: string) =>
    path === "/api/me/editions" ? { editions: [] } : mockMe,
  );
});
afterEach(() => resetViewedEdition());

describe("MeProvider editions", () => {
  it("restores the previous edition when the target edition cannot be loaded", async () => {
    const { result } = await renderHook(() => useMeContext(), { wrapper });
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith("/api/me/editions"));
    // The edition-global list still answers; only the scoped read rejects the key.
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path === "/api/me") throw new Error("unknown edition");
      return { editions: [] };
    });
    await act(async () => {
      await expect(result.current.switchEdition("nope-2099")).rejects.toThrow("unknown edition");
    });
    expect(getViewedEdition()).toBeNull();
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("restores the previous edition when the refetch itself throws", async () => {
    const { result } = await renderHook(() => useMeContext(), { wrapper });
    mockRefetch.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      await expect(result.current.switchEdition("hackudc-2025")).rejects.toThrow("boom");
    });
    expect(getViewedEdition()).toBeNull();
  });

  it("keeps the new edition once the session reloads", async () => {
    const { result } = await renderHook(() => useMeContext(), { wrapper });
    await act(async () => {
      await result.current.switchEdition("hackudc-2025");
    });
    expect(getViewedEdition()).toBe("hackudc-2025");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("refetches the profile and the editions when an edition changes", async () => {
    await renderHook(() => useMeContext(), { wrapper });
    await waitFor(() => expect(mockHandlers.get(EVENTS.EDITION_CHANGED)).toBeDefined());
    expect(mockHandlers.get(EVENTS.EDITION_CHANGED)?.scope).toBe(domainScope(SSE_TOPICS.IDENTITY));
    mockApiFetch.mockClear();
    await act(async () => {
      mockHandlers.get(EVENTS.EDITION_CHANGED)?.callback();
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/me/editions");
  });
});
