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

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

describe("GET /api/exports/stream (H54)", () => {
  it("403s without exports:run", async () => {
    const noCaps = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/exports/stream",
      headers: asUser(noCaps),
    });
    expect(res.statusCode).toBe(403);
  });

  it("opens an SSE stream for exports:run holders", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    // payloadAsStream so the never-ending SSE body doesn't hang the test.
    const res = await app.inject({
      method: "GET",
      url: "/api/exports/stream",
      headers: asUser(staff),
      payloadAsStream: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    const firstChunk: Buffer = await new Promise((resolve, reject) => {
      res.stream().once("data", resolve);
      res.stream().once("error", reject);
    });
    expect(firstChunk.toString()).toContain(": connected topic=exports");
    res.stream().destroy();
  });
});
