import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToSse } from "./sse-broker";

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();

  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    super();
    FakeEventSource.instances.push(this);
  }

  emit(name: string, data: unknown) {
    const event = new MessageEvent(name, { data: JSON.stringify(data) });
    if (name === "message") this.onmessage?.(event);
    else this.dispatchEvent(event);
  }
}

describe("SSE broker", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fans out one physical stream and closes it after the final unsubscribe", () => {
    const firstEvent = vi.fn();
    const secondEvent = vi.fn();
    const firstConnection = vi.fn();
    const secondConnection = vi.fn();
    const url = "https://api.test/api/queue/stream";

    const unsubscribeFirst = subscribeToSse(url, {
      events: ["queue.changed"],
      onConnectionChange: firstConnection,
      onEvent: firstEvent,
    });
    const unsubscribeSecond = subscribeToSse(url, {
      events: ["queue.changed"],
      onConnectionChange: secondConnection,
      onEvent: secondEvent,
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    source.onopen?.();
    source.emit("queue.changed", { type: "queue.changed", id: "1", at: "now", data: {} });
    expect(firstEvent).toHaveBeenCalledOnce();
    expect(secondEvent).toHaveBeenCalledOnce();
    expect(firstConnection).toHaveBeenLastCalledWith(true);
    expect(secondConnection).toHaveBeenLastCalledWith(true);

    unsubscribeFirst();
    expect(source.close).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("keeps event filters isolated between subscribers", () => {
    const queueEvent = vi.fn();
    const roomEvent = vi.fn();
    const unsubscribeQueue = subscribeToSse("/stream", {
      events: ["queue.changed"],
      onConnectionChange: vi.fn(),
      onEvent: queueEvent,
    });
    const unsubscribeRoom = subscribeToSse("/stream", {
      events: ["room.changed"],
      onConnectionChange: vi.fn(),
      onEvent: roomEvent,
    });

    FakeEventSource.instances[0].emit("queue.changed", {
      type: "queue.changed",
      id: "1",
      at: "now",
      data: {},
    });
    expect(queueEvent).toHaveBeenCalledOnce();
    expect(roomEvent).not.toHaveBeenCalled();

    unsubscribeQueue();
    unsubscribeRoom();
  });
});
