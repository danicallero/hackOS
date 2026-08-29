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

    const inbox = await pool.query(
      `SELECT badge_id, result FROM meal_scan_batch_items WHERE batch_id = $1`,
      [res.json().batchId],
    );
    expect(inbox.rows[0].badge_id).toBeNull();
    expect(inbox.rows[0].result).toMatchObject({ registered: true, timesEaten: 1 });
    expect(inbox.rows[0].result.card).toBeUndefined();
    expect(JSON.stringify(inbox.rows[0].result)).not.toContain("Test User");

    await processMealScanBatch({ data: { batchId: res.json().batchId } } as never);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1`,
      [uid],
    );
    expect(after.rows[0].n).toBe(1);
  });

  it("rejects a queued meal scan recorded before a badge replacement", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-REPLACED-OLD");
    const { rotateBadge } = await import("../../src/modules/logistics/accreditation.js");
    await rotateBadge(scanner, { userId: uid, newBadgeId: "OFF-REPLACED-NEW", reason: "lost" });

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query<{ badge_assigned_at: Date }>(
      `SELECT badge_assigned_at FROM users WHERE id = $1`,
      [uid],
    );
    const assignment = rows[0]?.badge_assigned_at;
    expect(assignment).toBeInstanceOf(Date);
    if (!assignment) throw new Error("Expected a badge assignment timestamp");

    const stale = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload: {
        deviceId: "scanner-replaced",
        scans: [
          {
            clientScanId: "stale-replacement-scan",
            badgeId: "OFF-REPLACED-NEW",
            allowRepeat: false,
            scannedAt: new Date(assignment.getTime() - 1_000).toISOString(),
          },
        ],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("badge_scan_before_assignment");
    expect((await pool.query(`SELECT 1 FROM meal_scan_batches`)).rowCount).toBe(0);
  });

  it("processes a queued batch after its submitting staff account is gone", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-NULL-ACTOR");

    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload: {
        deviceId: "scanner-null-actor",
        scans: [{ clientScanId: "scan-null-actor", badgeId: "OFF-NULL-ACTOR" }],
      },
    });
    expect(res.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE meal_scan_batches SET submitted_by = NULL WHERE id = $1`, [
      res.json().batchId,
    ]);

    const { processMealScanBatch } = await import("../../src/modules/logistics/offline-meals.js");
    await expect(
      processMealScanBatch({ data: { batchId: res.json().batchId } } as never),
    ).resolves.toMatchObject({ processed: 1, failed: 0 });
    expect(
      (await pool.query(`SELECT logged_by FROM activity_logs WHERE user_id = $1`, [uid])).rows[0]
        .logged_by,
    ).toBeNull();
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
