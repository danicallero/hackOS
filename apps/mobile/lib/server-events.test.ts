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
import {
  setServerEventIdentity,
  startLogisticsEventStream,
  startPersonalEventStream,
  startQueueEventStream,
  subscribeToServerEvent,
} from "./server-events";

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
let connections: {
  signal: AbortSignal;
  emit: (topic: string, id: number) => void;
  end: () => void;
}[];
const stops: (() => void)[] = [];
function mockResponse() {
  let resolve!: (result: { done: boolean; value?: Uint8Array }) => void;
  const queued: { done: boolean; value?: Uint8Array }[] = [];
  let waiting = false;
  const reader = {
    read: jest.fn(() =>
      queued.length
        ? Promise.resolve(queued.shift())
        : new Promise((done) => {
            resolve = done;
            waiting = true;
          }),
    ),
    cancel: jest.fn(async () => undefined),
  };
  const push = (result: { done: boolean; value?: Uint8Array }) => {
    if (waiting) {
      waiting = false;
      resolve(result);
    } else queued.push(result);
  };
  return { reader, push };
}
describe("multiplexed native events (#892)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    connections = [];
    setServerEventIdentity(101);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async (_url, init) => {
        const response = mockResponse();
        connections.push({
          signal: init.signal,
          emit(topic, id) {
            response.push({
              done: false,
              value: new TextEncoder().encode(
                `data: ${JSON.stringify({ topic, id: String(id), type: EVENTS.DOMAIN_CHANGED, at: "now", data: {} })}\n\n`,
              ),
            });
          },
          end: () => response.push({ done: true }),
        });
        return {
          ok: true,
          body: { getReader: () => response.reader },
          headers: new Headers({ "content-type": "text/event-stream" }),
        };
      }),
    });
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    setServerEventIdentity(null);
    jest.clearAllMocks();
    jest.useRealTimers();
  });
  it("does not connect for disabled readers", () => {
    startQueueEventStream(false)();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shares personal, operational and logistics subscriptions with the restored cookie", async () => {
    stops.push(startPersonalEventStream(), startQueueEventStream(), startLogisticsEventStream());
    await jest.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.hackos.test/api/realtime/stream?scopes=logistics%2Cpersonal%2Cqueue",
      expect.objectContaining({
        headers: { accept: "text/event-stream", cookie: "session=restored" },
      }),
    );
    expect(mockAppStateListeners.size).toBe(1);
  });
  it("keeps topic gaps and recovery signals scoped", async () => {
    const queue = jest.fn();
    const personal = jest.fn();
    const logistics = jest.fn();
    stops.push(
      startPersonalEventStream(),
      startQueueEventStream({ onResync: queue }),
      startLogisticsEventStream(),
    );
    stops.push(
      subscribeToServerEvent(EVENTS.REALTIME_RESYNC, personal),
      subscribeToServerEvent(EVENTS.REALTIME_RESYNC, logistics, "logistics"),
    );
    await jest.advanceTimersByTimeAsync(100);
    const source = connections[0];
    source.emit("queue", 10);
    source.emit("personal", 70);
    source.emit("queue", 11);
    source.emit("queue", 13);
    await settle();
    expect(queue).toHaveBeenCalledTimes(1);
    expect(personal).not.toHaveBeenCalled();
    expect(logistics).not.toHaveBeenCalled();
  });
  it("dispatches each event and recovery once even with several owners of one scope", async () => {
    const events = jest.fn();
    const recovery = jest.fn();
    stops.push(
      startPersonalEventStream(),
      startPersonalEventStream(),
      subscribeToServerEvent(EVENTS.DOMAIN_CHANGED, events),
      subscribeToServerEvent(EVENTS.REALTIME_RESYNC, recovery),
    );
    await jest.advanceTimersByTimeAsync(100);
    connections[0].emit("personal", 1);
    connections[0].emit("personal", 3);
    await settle();
    expect(events).toHaveBeenCalledTimes(1);
    expect(recovery).toHaveBeenCalledTimes(1);
  });

  it("foreground recovery owns one new reader and an aborted reader cannot retry or deliver", async () => {
    const resync = jest.fn();
    const events = jest.fn();
    stops.push(
      startQueueEventStream({ onResync: resync }),
      subscribeToServerEvent(EVENTS.DOMAIN_CHANGED, events, "queue"),
    );
    await jest.advanceTimersByTimeAsync(100);
    const old = connections[0];
    for (const listener of mockAppStateListeners) listener("background");
    for (const listener of mockAppStateListeners) listener("active");
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(old.signal.aborted).toBe(true);
    expect(resync).toHaveBeenCalledWith({
      reason: "foreground",
      path: "/api/queue/stream",
      lastEventId: null,
    });
    old.emit("queue", 1);
    await settle();
    await jest.advanceTimersByTimeAsync(5000);
    expect(events).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("account changes drop all old event listeners", async () => {
    const old = jest.fn();
    stops.push(startPersonalEventStream(), subscribeToServerEvent(EVENTS.DOMAIN_CHANGED, old));
    await jest.advanceTimersByTimeAsync(100);
    setServerEventIdentity(202);
    stops.push(startPersonalEventStream());
    await jest.advanceTimersByTimeAsync(100);
    connections[0].emit("personal", 1);
    connections[1].emit("personal", 2);
    await settle();
    expect(old).not.toHaveBeenCalled();
    expect(connections[0].signal.aborted).toBe(true);
  });
});
