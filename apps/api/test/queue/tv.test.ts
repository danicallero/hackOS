import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

let app: App;
let controllerId: number;
let outsiderId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  controllerId = await createUserWithCapabilities([CAPABILITIES.TV_CONTROL]);
  outsiderId = await createUser();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("TV manual mode control (H42)", () => {
  it("shows rooms by default, then keeps the manually selected mode until it is reset", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(initial.json()).toEqual({
      mode: "rooms",
      payload: null,
      broadcastAt: null,
      source: "default",
    });

    const selected = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(controllerId),
      payload: { mode: "live", payload: { sponsors: { show: false } } },
    });
    expect(selected.json()).toMatchObject({ mode: "live", source: "manual" });

    const current = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(current.json()).toMatchObject({ mode: "live", source: "manual" });

    const reset = await app.inject({
      method: "DELETE",
      url: "/api/tv/mode",
      headers: asUser(controllerId),
    });
    expect(reset.json()).toEqual({
      mode: "rooms",
      payload: null,
      broadcastAt: null,
      source: "default",
    });
  });

  it("rejects retired modes and scheduling fields", async () => {
    for (const payload of [{ mode: "timer" }, { mode: "wifi", expiresAt: null }]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/tv/mode",
        headers: asUser(controllerId),
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("discards stale Valkey payloads instead of interpreting them", async () => {
    const { valkey } = await import("../../src/lib/valkey.js");
    await valkey.set("tv:mode", JSON.stringify({ mode: "timer", payload: null }));

    const response = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(response.json()).toMatchObject({ mode: "rooms", source: "default" });
    expect(await valkey.get("tv:mode")).toBeNull();
  });

  it("keeps manual TV control behind TV_CONTROL", async () => {
    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: "/api/tv/mode",
        headers: asUser(outsiderId),
        payload: method === "PATCH" ? { mode: "live" } : undefined,
      });
      expect(response.statusCode).toBe(403);
    }
  });
});
