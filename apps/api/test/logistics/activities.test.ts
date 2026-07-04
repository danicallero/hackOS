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
import { assignBadge, createActivity, createMeal } from "./fixtures.js";

let app: App;
let scanner: number;
let manager: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
  manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
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

async function grant(activityId: number, userId: number) {
  await app.inject({
    method: "POST",
    url: `/api/activities/${activityId}/entitlements`,
    headers: asUser(manager),
    payload: { userId },
  });
}

describe("H25 meals", () => {
  it("first scan auto-registers, reports firstTime + card", async () => {
    const meal = await createMeal();
    const uid = await createUser({ name: "Mel" });
    await assignBadge(uid, "MB-1");
    await grant(meal, uid);

    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "MB-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.registered).toBe(true);
    expect(body.firstTime).toBe(true);
    expect(body.timesEaten).toBe(1);
    expect(body.card.name).toBe("Mel");
  });

  it("not entitled returns an explicit error that still shows the name", async () => {
    const meal = await createMeal();
    const uid = await createUser({ name: "Uninvited" });
    await assignBadge(uid, "MB-2");

    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "MB-2" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_entitled");
    expect(res.json().error.details.card.name).toBe("Uninvited");
  });

  it("repeat requires explicit confirmation, then registers with allowRepeat", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "MB-3");
    await grant(meal, uid);
    const { pool } = await import("../../src/db/pool.js");

    const first = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "MB-3" },
    });
    expect(first.statusCode).toBe(200);

    const repeat = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "MB-3" },
    });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().repeat).toBe(true);
    expect(repeat.json().registered).toBe(false);
    // still only one row — the repeat did not register
    let logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "MB-3", allowRepeat: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().timesEaten).toBe(2);
    logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(2);
    const audits = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'meal' AND action = 'repeat_override' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);
  });

  it("two simultaneous first-time scans register exactly once (concurrency)", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "MB-RACE");
    await grant(meal, uid);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/activities/${meal}/scan`,
        headers: asUser(scanner),
        payload: { badgeId: "MB-RACE" },
      }),
      app.inject({
        method: "POST",
        url: `/api/activities/${meal}/scan`,
        headers: asUser(scanner),
        payload: { badgeId: "MB-RACE" },
      }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]); // one registers, one sees the repeat

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
  });

  it("idempotency-key replays a meal scan without double-registering", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "MB-IDEM");
    await grant(meal, uid);
    const headers = { ...asUser(scanner), "idempotency-key": "meal-scan-1" };

    const first = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers,
      payload: { badgeId: "MB-IDEM" },
    });
    const replay = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers,
      payload: { badgeId: "MB-IDEM" },
    });
    expect(first.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
  });
});

describe("H26 registrable (non-meal) activities", () => {
  it("logs every scan without entitlement, flagging repeats", async () => {
    const workshop = await createActivity({ requiresScan: true, name: "Workshop" });
    const uid = await createUser();
    await assignBadge(uid, "WB-1");

    const first = await app.inject({
      method: "POST",
      url: `/api/activities/${workshop}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "WB-1" },
    });
    expect(first.json().firstTime).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: `/api/activities/${workshop}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "WB-1" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().registered).toBe(true);
    expect(second.json().repeat).toBe(true);

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(2);
  });

  it("rejects scanning an activity that is neither a meal nor requires_scan", async () => {
    const plain = await createActivity({ requiresScan: false, name: "Plain" });
    const uid = await createUser();
    await assignBadge(uid, "PB-1");
    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${plain}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "PB-1" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("entitlement admin (SCHEDULE_MANAGE)", () => {
  it("grant, revoke, and bulk-grant to confirmed participants", async () => {
    const meal = await createMeal();
    const { pool } = await import("../../src/db/pool.js");
    const { makeConfirmed } = await import("./fixtures.js");

    const u1 = await createUser();
    await makeConfirmed(u1);
    const u2 = await createUser();
    await makeConfirmed(u2);
    const unconfirmed = await createUser();

    const bulk = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/entitlements/bulk-grant-confirmed`,
      headers: asUser(manager),
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().granted).toBe(2);

    const ent = await pool.query(`SELECT user_id FROM meal_entitlements WHERE activity_id = $1`, [
      meal,
    ]);
    const ids = ent.rows.map((r: { user_id: number }) => r.user_id).sort();
    expect(ids).toEqual([u1, u2].sort());
    expect(ids).not.toContain(unconfirmed);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/activities/${meal}/entitlements/${u1}`,
      headers: asUser(manager),
    });
    expect(revoke.json().revoked).toBe(true);
    const after = await pool.query(
      `SELECT 1 FROM meal_entitlements WHERE activity_id = $1 AND user_id = $2`,
      [meal, u1],
    );
    expect(after.rows).toHaveLength(0);
  });

  it("scanner without SCHEDULE_MANAGE cannot grant entitlements", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/entitlements`,
      headers: asUser(scanner),
      payload: { userId: uid },
    });
    expect(res.statusCode).toBe(403);
  });
});
