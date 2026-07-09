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
let doorStaff: number;
let statsStaff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  doorStaff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
  statsStaff = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
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

describe("H24 presence scan + estimation", () => {
  it("records a door in for a current badge", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-1", kind: "in", location: "gate" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe("in");

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM time_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].scanned_by).toBe(doorStaff);
  });

  it("rejects an unknown badge", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "ghost", kind: "in" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("badge_unknown");
  });

  it("accepts a backdated manual entry and audits it; rejects a future one", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-2");
    const past = new Date(Date.now() - 3_600_000).toISOString();

    const ok = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-2", kind: "in", scannedAt: past },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().manual).toBe(true);

    const { pool } = await import("../../src/db/pool.js");
    const audits = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'presence' AND action = 'manual_time_log' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const bad = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-2", kind: "in", scannedAt: future },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("occupancy estimate counts a just-arrived person and hours combine door+meal", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-3");
    // arrived just now
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-3", kind: "in" },
    });

    const est = await app.inject({
      method: "GET",
      url: "/api/presence/estimate",
      headers: asUser(statsStaff),
    });
    expect(est.statusCode).toBe(200);
    expect(est.json().presentCount).toBe(1);
    expect(est.json().present).toContain(uid);

    // a meal an hour ago also contributes to the hours estimate
    const meal = await createMeal();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO activity_logs (user_id, activity_id, logged_by, logged_at)
       VALUES ($1, $2, $3, now() - interval '1 hour')`,
      [uid, meal, doorStaff],
    );

    const hours = await app.inject({
      method: "GET",
      url: `/api/presence/hours/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(hours.statusCode).toBe(200);
    expect(hours.json().hours).toBeGreaterThan(0);

    const bulk = await app.inject({
      method: "GET",
      url: "/api/presence/hours",
      headers: asUser(statsStaff),
    });
    expect(bulk.json().some((r: { userId: number }) => r.userId === uid)).toBe(true);
  });

  it("lets a PRESENCE_SCAN door operator read estimate/hours", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/presence/estimate",
      headers: asUser(doorStaff), // only PRESENCE_SCAN
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects estimate/hours reads without presence or stats capability", async () => {
    const nobody = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/presence/estimate",
      headers: asUser(nobody),
    });
    expect(res.statusCode).toBe(403);
  });
});
