import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { physicalSseConnectionStats } from "./realtime-telemetry";
import { setSseIdentity, subscribeToSse } from "./sse-broker";
import { mockRealtimeFetch } from "./sse-test-fixture";

const origin = "https://api.test";
const mux = `${origin}/api/realtime/stream`;
let fixture: ReturnType<typeof mockRealtimeFetch>;
const disposers: (() => void)[] = [];
const subscribe = (path: string, options: Parameters<typeof subscribeToSse>[1] = {}) => {
  const dispose = subscribeToSse(`${origin}${path}`, options);
  disposers.push(dispose);
  return dispose;
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("multiplexed SSE broker (#892)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSseIdentity(null, origin);
    setSseIdentity(101, origin);
    fixture = mockRealtimeFetch();
  });
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    setSseIdentity(null, origin);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces unrelated topics and inconsistent component identity keys into one socket", async () => {
    const personal = vi.fn();
    const queue = vi.fn();
    const sponsors = vi.fn();
    const first = subscribe("/api/queue/me/stream", { identityKey: "shell", onEvent: personal });
    subscribe("/api/queue/stream", { identityKey: 101, onEvent: queue });
    subscribe("/api/events/stream?topic=sponsors", { onEvent: sponsors });
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    expect(fixture.connections[0].url).toBe(`${mux}?scopes=domain%3Asponsors%2Cpersonal%2Cqueue`);
    expect(physicalSseConnectionStats(mux).active).toBe(1);
    fixture.connections[0].emit("personal", 1, "user.notification");
    await settle();
    expect(personal).toHaveBeenCalledOnce();
    expect(queue).not.toHaveBeenCalled();
    expect(sponsors).not.toHaveBeenCalled();
    first();
    expect(fixture.connections[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
  });

  it("reference counts identical subscriptions and releases the final reader", async () => {
    const first = subscribe("/api/queue/stream");
    const second = subscribe("/api/queue/stream");
    await vi.advanceTimersByTimeAsync(100);
    first();
    expect(fixture.connections[0].signal.aborted).toBe(false);
    second();
    expect(fixture.connections[0].signal.aborted).toBe(true);
    expect(physicalSseConnectionStats(mux).active).toBe(0);
  });

  it("filters names and tracks interleaved sequence IDs independently by topic", async () => {
    const queueEvent = vi.fn();
    const sponsorEvent = vi.fn();
    const queueResync = vi.fn();
    const sponsorResync = vi.fn();
    subscribe("/api/queue/stream", {
      events: ["queue.changed"],
      onEvent: queueEvent,
      onResync: queueResync,
    });
    subscribe("/api/events/stream?topic=sponsors", {
      onEvent: sponsorEvent,
      onResync: sponsorResync,
    });
    await vi.advanceTimersByTimeAsync(100);
    const source = fixture.connections[0];
    source.emit("queue", 10, "queue.changed");
    source.emit("domain:sponsors", 80);
    source.emit("queue", 11, "room.changed");
    source.emit("domain:sponsors", 81);
    source.emit("queue", 13, "queue.changed");
    await settle();
    expect(queueEvent).toHaveBeenCalledOnce();
    expect(sponsorEvent).toHaveBeenCalledTimes(2);
    expect(queueResync).toHaveBeenCalledExactlyOnceWith({
      reason: "gap",
      topic: "queue",
      lastEventId: "11",
    });
    expect(sponsorResync).not.toHaveBeenCalled();
  });

  it("recovers once after reconnect without sending a misleading global cursor", async () => {
    const resync = vi.fn();
    subscribe("/api/queue/stream", { onResync: resync });
    await vi.advanceTimersByTimeAsync(100);
    fixture.connections[0].emit("queue", 10);
    await settle();
    fixture.connections[0].end();
    await settle();
    await vi.advanceTimersByTimeAsync(1250);
    expect(resync).toHaveBeenCalledExactlyOnceWith({
      reason: "reconnect",
      topic: "queue",
      lastEventId: "10",
    });
    expect(fixture.fetcher.mock.calls[1][1].headers).not.toHaveProperty("last-event-id");
    fixture.connections[1].emit("queue", 50);
    await settle();
    expect(resync).toHaveBeenCalledOnce();
  });

  it("drops delayed old-account frames and old listeners after account switching", async () => {
    const old = vi.fn();
    subscribe("/api/queue/me/stream", { onEvent: old });
    await vi.advanceTimersByTimeAsync(100);
    const source = fixture.connections[0];
    setSseIdentity(202, origin);
    const next = vi.fn();
    subscribe("/api/queue/me/stream", { onEvent: next });
    source.emit("personal", 1);
    await vi.advanceTimersByTimeAsync(100);
    fixture.connections[1].emit("personal", 2);
    await settle();
    expect(source.signal.aborted).toBe(true);
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it("joins participant, projects, scanner, queue and collaborative review readers", async () => {
    for (const path of [
      "/api/queue/me/stream",
      "/api/events/stream?topic=projects",
      "/api/logistics/stream",
      "/api/queue/stream",
      "/api/queue/entries/42/stream",
    ])
      subscribe(path);
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    expect(fixture.connections[0].url).toBe(
      `${mux}?scopes=domain%3Aprojects%2Clogistics%2Cpersonal%2Cqueue%2Creview%3A42`,
    );
  });

  it("origin switching and sign-out discard the old reader and listeners", async () => {
    const old = vi.fn();
    subscribe("/api/queue/me/stream", { onEvent: old });
    await vi.advanceTimersByTimeAsync(100);
    setSseIdentity(101, "https://next.test");
    const next = vi.fn();
    disposers.push(subscribeToSse("https://next.test/api/queue/me/stream", { onEvent: next }));
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.connections[0].signal.aborted).toBe(true);
    expect(fixture.connections[1].url).toContain("https://next.test/");
    fixture.connections[0].emit("personal", 1);
    await settle();
    expect(old).not.toHaveBeenCalled();
    setSseIdentity(null, "https://next.test");
    fixture.connections[1].emit("personal", 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.connections[1].signal.aborted).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
  });

  it("disconnects an oversized UTF-8 frame and recovers with one scoped resync", async () => {
    const event = vi.fn();
    const resync = vi.fn();
    subscribe("/api/queue/stream", { onEvent: event, onResync: resync });
    await vi.advanceTimersByTimeAsync(100);
    // Under 64 KiB in characters, over the byte bound: measure UTF-8 bytes.
    fixture.connections[0].raw(`data: ${"é".repeat(33_000)}`);
    await settle();
    expect(fixture.connections[0].signal.aborted).toBe(true);
    expect(event).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1250);
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenCalledExactlyOnceWith({
      reason: "reconnect",
      topic: "queue",
      lastEventId: null,
    });
  });

  it("keeps anonymous TV on one payload-free legacy stream", async () => {
    setSseIdentity(null, origin);
    subscribe("/api/tv/stream");
    subscribe("/api/tv/stream");
    await vi.advanceTimersByTimeAsync(100);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    expect(fixture.connections[0].url).toBe(`${origin}/api/tv/stream`);
  });

  it("honors Retry-After and stops retrying forbidden scope sets", async () => {
    fixture.fetcher.mockResolvedValueOnce({
      ok: false,
      status: 429,
      body: null as never,
      headers: new Headers({ "retry-after": "120" }),
    });
    subscribe("/api/queue/stream");
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    fixture.fetcher.mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: null as never,
      headers: new Headers(),
    });
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
  });
});
