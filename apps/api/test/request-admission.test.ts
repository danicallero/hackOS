import { beforeEach, describe, expect, it } from "vitest";
import { RequestAdmission } from "../src/lib/request-admission.js";
import {
  classifyRequestLane,
  laneForSseTopic,
  metricTopicForSse,
  type RequestLane,
} from "../src/lib/request-lanes.js";

describe("event-day request lanes (#544)", () => {
  // #1113: record the order in which waiters are admitted and assert it.
  const admitted: string[] = [];
  const track = (admission: RequestAdmission, name: string, lane: RequestLane, role?: number) =>
    admission.acquire(lane, role).then((lease) => {
      admitted.push(name);
      return lease;
    });
  beforeEach(() => {
    admitted.length = 0;
  });

  it("keeps a high-priority slot available while best-effort work is active", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 2,
      reservedHighPriority: 1,
      maxBestEffortPending: 1,
    });
    const participant = await admission.acquire("P3");
    const queuedParticipant = track(admission, "queued-participant", "P3");
    await Promise.resolve();
    expect(admission.activeCount).toBe(1);
    expect(admission.queuedCount).toBe(1);

    // The reserved slot goes to P0 immediately while P3 stays pending.
    const operator = await admission.acquire("P0");
    expect(admission.activeCount).toBe(2);
    expect(admitted).toEqual([]);

    operator.release();
    participant.release();
    (await queuedParticipant).release();
    expect(admitted).toEqual(["queued-participant"]);
    expect(admission.activeCount).toBe(0);
  });

  it("sheds only bounded best-effort waiters", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 1,
      reservedHighPriority: 0,
      maxBestEffortPending: 1,
    });
    const active = await admission.acquire("P3");
    const waiting = track(admission, "best-effort", "P3");

    await expect(admission.acquire("P3")).rejects.toMatchObject({
      statusCode: 429,
      code: "too_many_requests",
    });
    expect(admission.queuedCount).toBe(1);
    // P0 is never rejected by the best-effort bound and takes the next slot.
    const operationalWaiting = track(admission, "operational", "P0");
    expect(admission.queuedCount).toBe(2);
    active.release();
    const operational = await operationalWaiting;
    operational.release();
    (await waiting).release();
    expect(admitted).toEqual(["operational", "best-effort"]);
  });

  it("serves the highest-position role before lower roles across lanes", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 1,
      reservedHighPriority: 0,
    });
    const active = await admission.acquire("P0", 500);
    const lowerRole = track(admission, "lower-role-P0", "P0", 5_000);
    const higherRole = track(admission, "higher-role-P3", "P3", 19_000);

    active.release();
    (await higherRole).release();
    (await lowerRole).release();
    expect(admitted).toEqual(["higher-role-P3", "lower-role-P0"]);
  });

  it("keeps reserved capacity from authenticated best-effort requests", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 2,
      reservedHighPriority: 1,
    });
    const activeParticipant = await admission.acquire("P3", 500);
    const waitingSponsor = track(admission, "sponsor", "P3", 1_000);
    const activeOperational = await admission.acquire("P0", 5_000);
    await Promise.resolve();

    // Reserved slot is taken by P0; the best-effort sponsor must keep waiting.
    expect(admission.activeCount).toBe(2);
    expect(admission.queuedCount).toBe(1);
    expect(admitted).toEqual([]);

    activeParticipant.release();
    await Promise.resolve();
    // One slot is free but it is the reserved one, so P3 is still not admitted.
    expect(admitted).toEqual([]);

    activeOperational.release();
    (await waitingSponsor).release();
    expect(admitted).toEqual(["sponsor"]);
  });

  it("keeps the endpoint lane ordering for users at the same role level", async () => {
    const admission = new RequestAdmission({
      maxConcurrent: 1,
      reservedHighPriority: 0,
    });
    const active = await admission.acquire("P3", 500);
    const participantPath = track(admission, "participant-P3", "P3", 500);
    const operationalPath = track(admission, "operational-P0", "P0", 500);

    active.release();
    (await operationalPath).release();
    (await participantPath).release();
    expect(admitted).toEqual(["operational-P0", "participant-P3"]);
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
