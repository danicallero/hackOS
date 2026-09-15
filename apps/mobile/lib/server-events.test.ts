const mockAppStateListeners = new Set<(state: "active" | "background") => void>();

jest.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: "active" | "background") => void) => {
      mockAppStateListeners.add(listener);
      return { remove: () => mockAppStateListeners.delete(listener) };
    },
  },
  Platform: { OS: "ios" },
}));
jest.mock("./auth-client", () => ({
  authClient: { getCookie: jest.fn(() => "session=restored") },
}));
jest.mock("./env", () => ({ API_URL: "https://api.hackos.test" }));

import { EVENTS } from "@hackos/shared/events";
import { authClient } from "./auth-client";
import { startQueueEventStream, subscribeToServerEvent } from "./server-events";

const mockGetCookie = authClient.getCookie as jest.Mock;

describe("operational native event streams", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAppStateListeners.clear();
    mockGetCookie.mockClear().mockReturnValue("session=restored");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: jest.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    // Expo exposes fetch through a lazy global accessor. Restoring that
    // accessor lets Jest's environment teardown import Expo Winter fetch after
    // the test has ended, which emits a native-module warning and fails the
    // suite. This Jest file owns its sandbox, so retain the inert mock until
    // that sandbox is discarded instead.
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("does not open the operational stream while its capability gate is disabled", () => {
    const stop = startQueueEventStream(false);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    stop();
  });

  it("sends the restored session cookie on the initial connection and reconnect", async () => {
    const read = jest.fn().mockResolvedValue({ done: true, value: undefined });
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read }) },
    });

    const stop = startQueueEventStream();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.hackos.test/api/queue/stream",
      expect.objectContaining({
        headers: { accept: "text/event-stream", cookie: "session=restored" },
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.hackos.test/api/queue/stream",
      expect.objectContaining({
        headers: { accept: "text/event-stream", cookie: "session=restored" },
      }),
    );
    expect(mockGetCookie).toHaveBeenCalledTimes(2);

    stop();
  });

  it("refetches on reconnect and a real event-id gap", async () => {
    const encoder = new TextEncoder();
    const firstReader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode('data: {"type":"queue.changed","id":"10"}\n\n'),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const secondReader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(
            'data: {"type":"queue.changed","id":"12"}\n\ndata: {"type":"queue.changed","id":"14"}\n\n',
          ),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => firstReader } })
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => secondReader } });
    const onResync = jest.fn();
    const syntheticResync = jest.fn();
    const removeSynthetic = subscribeToServerEvent(EVENTS.REALTIME_RESYNC, syntheticResync);

    const stop = startQueueEventStream({ onResync });
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(onResync).toHaveBeenNthCalledWith(1, {
      reason: "reconnect",
      path: "/api/queue/stream",
      lastEventId: "10",
    });
    expect(onResync).toHaveBeenNthCalledWith(2, {
      reason: "gap",
      path: "/api/queue/stream",
      lastEventId: "12",
    });
    expect(syntheticResync).toHaveBeenCalledTimes(2);
    expect((globalThis.fetch as jest.Mock).mock.calls[1][1].headers["last-event-id"]).toBe("10");

    removeSynthetic();
    stop();
  });

  it("refetches when the app returns to the foreground", async () => {
    let resolveRead!: (result: { done: boolean; value?: Uint8Array }) => void;
    const pendingRead = new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
      resolveRead = resolve;
    });
    const firstReader = { read: jest.fn(() => pendingRead) };
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: { getReader: () => firstReader },
    });
    const onResync = jest.fn();
    const stop = startQueueEventStream({ onResync });
    await Promise.resolve();
    await Promise.resolve();

    for (const listener of mockAppStateListeners) listener("background");
    for (const listener of mockAppStateListeners) listener("active");

    expect(onResync).toHaveBeenCalledWith({
      reason: "foreground",
      path: "/api/queue/stream",
      lastEventId: null,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    resolveRead({ done: true });
    stop();
  });
});
