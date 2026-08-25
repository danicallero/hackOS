import { describe, expect, it } from "vitest";
import { RequestAdmission } from "../src/lib/request-admission.js";
import {
  classifyRequestLane,
  laneForSseTopic,
  metricTopicForSse,
} from "../src/lib/request-lanes.js";

describe("event-day request lanes (#544)", () => {
  it("keeps a high-priority slot available while best-effort work is active", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 2,
      reservedHighPriority: 1,
      maxBestEffortPending: 1,
    });
    const participant = await admission.acquire("P3");
    const queuedParticipant = admission.acquire("P3");

    const operator = await admission.acquire("P0");
    operator.release();
    participant.release();
    const admittedParticipant = await queuedParticipant;
    admittedParticipant.release();
  });

  it("sheds only bounded best-effort waiters", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 1,
      reservedHighPriority: 0,
      maxBestEffortPending: 1,
    });
    const active = await admission.acquire("P3");
    const waiting = admission.acquire("P3");

    await expect(admission.acquire("P3")).rejects.toMatchObject({
      statusCode: 429,
      code: "too_many_requests",
    });
    // P0 is never rejected by the best-effort bound and takes the next slot.
    const operationalWaiting = admission.acquire("P0");
    active.release();
    const operational = await operationalWaiting;
    operational.release();
    (await waiting).release();
  });

  it("classifies operational, collaboration, public-TV and participant paths", () => {
    expect(classifyRequestLane({ url: "/api/queue/stream", method: "GET" })).toBe("P0");
    expect(classifyRequestLane({ url: "/api/queue/entries/42/stream", method: "GET" })).toBe("P1");
    expect(classifyRequestLane({ url: "/api/tv/rooms", method: "GET" })).toBe("P2");
    expect(classifyRequestLane({ url: "/api/queue/me", method: "GET", userId: 7 })).toBe("P3");
  });

  it("keeps SSE metric topics bounded while retaining lane ownership", () => {
    expect(laneForSseTopic("queue-review:123")).toBe("P1");
    expect(metricTopicForSse("queue-review:123")).toBe("queue-review");
    expect(laneForSseTopic("user:456")).toBe("P3");
    expect(metricTopicForSse("user:456")).toBe("user");
  });
});
