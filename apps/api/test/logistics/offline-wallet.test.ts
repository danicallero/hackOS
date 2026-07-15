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
import { assignBadge, createMeal } from "./fixtures.js";

let app: App;
let scanner: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
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

describe("H25 offline meal scan queue", () => {
  it("accepts a local scanner batch and the worker processes each scan once", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-1");

    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload: {
        deviceId: "scanner-a",
        scans: [{ clientScanId: "scan-1", badgeId: "OFF-1" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const { processMealScanBatch } = await import("../../src/modules/logistics/offline-meals.js");
    await processMealScanBatch({ data: { batchId: res.json().batchId } } as never);

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(
      `SELECT source_device_id, source_scan_id FROM activity_logs WHERE user_id = $1`,
      [uid],
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].source_device_id).toBe("scanner-a");

    await processMealScanBatch({ data: { batchId: res.json().batchId } } as never);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1`,
      [uid],
    );
    expect(after.rows[0].n).toBe(1);
  });

  it("deduplicates client scan ids from the same device", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-2");

    const payload = {
      deviceId: "scanner-b",
      scans: [{ clientScanId: "same", badgeId: "OFF-2" }],
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload,
    });
    expect(first.json().accepted).toBe(1);
    expect(second.json().accepted).toBe(0);
    expect(second.json().duplicate).toBe(1);
  });
});
