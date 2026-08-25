import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeRefetch,
  type RealtimeTelemetryScope,
  telemetryScopeForStream,
} from "./realtime-telemetry";

const scope: RealtimeTelemetryScope = { surface: "participant-queue", topic: "user" };

describe("browser realtime telemetry (H38, #544)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports one bounded aggregate after a refetch storm", () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const now = 1_000_000;

    for (let index = 0; index < 10; index += 1) observeRefetch(scope, "sse", now);
    for (let index = 0; index < 5; index += 1) observeRefetch(scope, "sse", now + 1_000);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({
      surface: "participant-queue",
      topic: "user",
      trigger: "sse",
      refetches: 10,
      windowSeconds: 30,
    });
  });

  it("maps only allowlisted streams and strips identifiers from the scope", () => {
    expect(telemetryScopeForStream("/api/queue/me/stream?userId=123")).toEqual({
      surface: "participant-queue",
      topic: "user",
    });
    expect(telemetryScopeForStream("/api/queue/entries/123/stream")).toEqual({
      surface: "judging",
      topic: "queue-review",
    });
    expect(telemetryScopeForStream("/api/events/stream?topic=identity")).toBeNull();
  });
});
