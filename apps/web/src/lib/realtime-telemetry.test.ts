import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeRefetch,
  type RealtimeTelemetryScope,
  telemetryScopeForRealtimeScope,
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

  it("maps only allowlisted scopes and strips identifiers from the scope", () => {
    expect(telemetryScopeForRealtimeScope("personal")).toEqual({
      surface: "participant-queue",
      topic: "user",
    });
    expect(telemetryScopeForRealtimeScope("review:123")).toEqual({
      surface: "judging",
      topic: "queue-review",
    });
    expect(telemetryScopeForRealtimeScope("domain:logistics")).toEqual({
      surface: "logistics",
      topic: "logistics",
    });
    expect(telemetryScopeForRealtimeScope("domain:identity")).toBeNull();
  });

  it("maps only the physical multiplexed and public stream URLs", () => {
    expect(telemetryScopeForStream("/api/realtime/stream?scopes=personal")).toEqual({
      surface: "participant-queue",
      topic: "multiplexed",
    });
    expect(telemetryScopeForStream("/api/tv/stream")).toEqual({
      surface: "public-tv",
      topic: "public-tv",
    });
    expect(telemetryScopeForStream("/api/queue/me/stream?userId=123")).toBeNull();
  });
});
