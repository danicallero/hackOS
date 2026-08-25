import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp } from "./helpers.js";

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  const { pool } = await import("../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("browser refetch-storm telemetry (H38, #544)", () => {
  it("accepts only bounded, low-cardinality observations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telemetry/refetch-storm",
      payload: {
        surface: "participant-queue",
        topic: "user",
        trigger: "sse",
        refetches: 12,
        windowSeconds: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });

    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.body).toContain("hackos_browser_refetch_storms_total");
    expect(metrics.body).toContain('surface="participant-queue"');
    expect(metrics.body).toContain('topic="user"');
  });

  it("rejects identity-bearing or out-of-range fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telemetry/refetch-storm",
      payload: {
        surface: "participant-queue",
        topic: "user:123",
        trigger: "sse",
        refetches: 12,
        windowSeconds: 30,
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
