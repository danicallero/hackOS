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

describe("H25 meals", () => {
  it("first scan auto-registers, reports firstTime + card", async () => {
    const meal = await createMeal();
    const uid = await createUser({ name: "Mel" });
    await assignBadge(uid, "MB-1");

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

  it("rejects an offline activity scan recorded before a badge replacement", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "MB-REPLACED-OLD");
    const { rotateBadge } = await import("../../src/modules/logistics/accreditation.js");
    await rotateBadge(scanner, { userId: uid, newBadgeId: "MB-REPLACED-NEW", reason: "lost" });

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
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: {
        badgeId: "MB-REPLACED-NEW",
        scannedAt: new Date(assignment.getTime() - 1_000).toISOString(),
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("badge_scan_before_assignment");
    expect(
      (await pool.query(`SELECT 1 FROM activity_logs WHERE user_id = $1`, [uid])).rowCount,
    ).toBe(0);
  });

  it("repeat requires explicit confirmation, then registers with allowRepeat", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "MB-3");
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
  it("gates repeats behind explicit confirmation, like meals", async () => {
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

    // A repeated scan does not re-register: it asks for confirmation.
    const second = await app.inject({
      method: "POST",
      url: `/api/activities/${workshop}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "WB-1" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().registered).toBe(false);
    expect(second.json().repeat).toBe(true);

    // Confirming with allowRepeat registers the audited override.
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/activities/${workshop}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "WB-1", allowRepeat: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().registered).toBe(true);
    expect(confirmed.json().repeat).toBe(true);

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM activity_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(2);
    const audits = await pool.query(
      `SELECT * FROM audit_log
        WHERE entity_type = 'activity' AND action = 'repeat_override' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);
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
