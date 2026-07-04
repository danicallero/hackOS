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

/** H45/H47: event config — public hacking window + admin edit. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("event config (H45/H47)", () => {
  it("serves public defaults with no auth even after truncation", async () => {
    const a = await getApp();
    const res = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      hackingStartsAt: null,
      hackingEndsAt: null,
      timezone: "Europe/Madrid",
    });
  });

  it("requires SCHEDULE_MANAGE to edit", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(pleb),
      payload: { name: "hackOS" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("upserts the hacking window and reveals it publicly", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const start = "2026-07-04T09:00:00.000Z";
    const end = "2026-07-05T09:00:00.000Z";
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { name: "hackOS 2026", hackingStartsAt: start, hackingEndsAt: end },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe("hackOS 2026");

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(new Date(pub.json().hackingStartsAt).toISOString()).toBe(start);
    expect(new Date(pub.json().hackingEndsAt).toISOString()).toBe(end);
  });

  it("rejects an end before the start", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: {
        hackingStartsAt: "2026-07-05T09:00:00.000Z",
        hackingEndsAt: "2026-07-04T09:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
