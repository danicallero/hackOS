import { beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { useTestApp } from "./helpers.js";

const getApp = useTestApp();
let app: App;

beforeAll(async () => {
  app = await getApp();
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

  it("accepts the bounded fallback-poll trigger", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/telemetry/refetch-storm",
      payload: {
        surface: "participant-queue",
        topic: "user",
        trigger: "poll",
        refetches: 2,
        windowSeconds: 30,
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
