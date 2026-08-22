import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("H24 presence scan + estimation", () => {
  it("records a door in for a current badge", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-1", kind: "in" },
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

    // Simulate the API clock lagging behind PostgreSQL. Live estimates must
    // use the database clock or the just-committed scan is filtered out.
    const nodeNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(nodeNow - 60_000);

    const est = await app.inject({
      method: "GET",
      url: "/api/presence/estimate",
      headers: asUser(statsStaff),
    });
    expect(est.statusCode).toBe(200);
    expect(est.json().presentCount).toBe(1);
    expect(est.json().present).toContain(uid);

    const { userHours } = await import("../../src/modules/logistics/presence.js");
    const justArrivedHours = await userHours(uid);
    expect(justArrivedHours.intervals).toHaveLength(1);

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

  it("never lets an entrance exist without a way to close it: rejects a duplicate in, requires reconciliation, then allows out then in", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-4");

    const firstIn = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4", kind: "in" },
    });
    expect(firstIn.statusCode).toBe(200);

    // A second `in` while the session is still open is rejected — the
    // system never auto-closes it to make room.
    const dupeIn = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4", kind: "in" },
    });
    expect(dupeIn.statusCode).toBe(409);
    expect(dupeIn.json().error.code).toBe("conflict");

    // Lookup surfaces the open session so staff know to reconcile first.
    const lookup1 = await app.inject({
      method: "POST",
      url: "/api/presence/lookup",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4" },
    });
    expect(lookup1.json().openSince).not.toBeNull();

    // An `out` with no open session is likewise rejected.
    const uid2 = await createUser();
    await assignBadge(uid2, "P-5");
    const orphanOut = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-5", kind: "out" },
    });
    expect(orphanOut.statusCode).toBe(409);

    // Staff reconciles by closing the open session with a manual out...
    const close = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4", kind: "out" },
    });
    expect(close.statusCode).toBe(200);

    // ...after which a new entrance is accepted again.
    const secondIn = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4", kind: "in" },
    });
    expect(secondIn.statusCode).toBe(200);

    const lookup2 = await app.inject({
      method: "POST",
      url: "/api/presence/lookup",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-4" },
    });
    expect(lookup2.json().openSince).not.toBeNull();
  });

  it("lists open sessions for staff reconciliation, flagging stale ones", async () => {
    const fresh = await createUser();
    await assignBadge(fresh, "P-6");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-6", kind: "in" },
    });

    const stale = await createUser();
    await assignBadge(stale, "P-7");
    const longAgo = new Date(Date.now() - 20 * 3_600_000).toISOString();
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-7", kind: "in", scannedAt: longAgo },
    });

    const closed = await createUser();
    await assignBadge(closed, "P-8");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-8", kind: "in" },
    });
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-8", kind: "out" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/presence/open",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { userId: number; stale: boolean }[];
    const byUser = new Map(items.map((i) => [i.userId, i]));
    expect(byUser.get(fresh)?.stale).toBe(false);
    expect(byUser.get(stale)?.stale).toBe(true);
    expect(byUser.has(closed)).toBe(false);
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

describe("H24 raw scan admin (view/edit/delete)", () => {
  it("lists a user's raw scans, edits one, and audits the change", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-10");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-10", kind: "in" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/presence/logs/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    const logId = list.json().items[0].id;
    expect(list.json().items[0].kind).toBe("in");

    const newTime = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/presence/logs/${logId}`,
      headers: asUser(doorStaff),
      payload: { kind: "out", scannedAt: newTime },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().kind).toBe("out");

    const { pool } = await import("../../src/db/pool.js");
    const audits = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'presence' AND action = 'edit_time_log' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].actor_id).toBe(doorStaff);
  });

  it("rejects editing a scan into the future", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-11");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-11", kind: "in" },
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/presence/logs/${uid}`,
      headers: asUser(doorStaff),
    });
    const logId = list.json().items[0].id;

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/presence/logs/${logId}`,
      headers: asUser(doorStaff),
      payload: { scannedAt: future },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s editing/deleting a time log that doesn't exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/presence/logs/999999`,
      headers: asUser(doorStaff),
      payload: { kind: "out" },
    });
    expect(res.statusCode).toBe(404);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/presence/logs/999999`,
      headers: asUser(doorStaff),
    });
    expect(del.statusCode).toBe(404);
  });

  it("deletes a bad scan and audits it", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-12");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-12", kind: "in" },
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/presence/logs/${uid}`,
      headers: asUser(doorStaff),
    });
    const logId = list.json().items[0].id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/presence/logs/${logId}`,
      headers: asUser(doorStaff),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);

    const { pool } = await import("../../src/db/pool.js");
    const remaining = await pool.query(`SELECT * FROM time_logs WHERE id = $1`, [logId]);
    expect(remaining.rows).toHaveLength(0);

    const audits = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'presence' AND action = 'delete_time_log' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);
  });

  it("rejects editing/deleting scans without the presence capability", async () => {
    const uid = await createUser();
    await assignBadge(uid, "P-13");
    await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "P-13", kind: "in" },
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/presence/logs/${uid}`,
      headers: asUser(statsStaff),
    });
    const logId = list.json().items[0].id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/presence/logs/${logId}`,
      headers: asUser(statsStaff), // stats-only, not presence:scan
      payload: { kind: "out" },
    });
    expect(patch.statusCode).toBe(403);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/presence/logs/${logId}`,
      headers: asUser(statsStaff),
    });
    expect(del.statusCode).toBe(403);
  });
});

describe("H24 illegal in→in conflicts in the timeline", () => {
  it("exposes conflicts[] with bounds and zero-credits the first window", async () => {
    const uid = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const t0 = new Date(Date.now() - 4 * 3_600_000).toISOString();
    const t1 = new Date(Date.now() - 2 * 3_600_000).toISOString();
    // The scan endpoint rejects in→in live; manual signal creation is the
    // only way this state appears (e.g. staff deleted the out in between).
    for (const occurredAt of [t0, t1]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/presence/signals/${uid}`,
        headers: asUser(doorStaff),
        payload: { kind: "in", occurredAt },
      });
      expect(res.statusCode).toBe(201);
    }

    const timeline = await app.inject({
      method: "GET",
      url: `/api/presence/timeline/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(timeline.statusCode).toBe(200);
    const body = timeline.json();
    expect(body.conflicts).toHaveLength(1);
    const logs = await pool.query(
      `SELECT id FROM time_logs WHERE user_id = $1 ORDER BY scanned_at ASC`,
      [uid],
    );
    expect(body.conflicts[0]).toMatchObject({
      firstLogId: logs.rows[0].id,
      secondLogId: logs.rows[1].id,
      from: new Date(t0).toISOString(),
      to: new Date(t1).toISOString(),
    });
    // The conflicted first window credits nothing; only the second counts.
    expect(body.windows[0]).toMatchObject({ status: "invalid", conflict: true });
    expect(body.windows[1]).toMatchObject({ status: "provisional", conflict: false });
    const hours = await app.inject({
      method: "GET",
      url: `/api/presence/hours/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(hours.json().hours).toBeCloseTo(2, 1);
  });

  it("does not flag in→activity→in — the activity closes the pair", async () => {
    const uid = await createUser();
    const meal = await createMeal();
    const times = [6, 4, 2].map((h) => new Date(Date.now() - h * 3_600_000).toISOString());
    const payloads = [
      { kind: "in", occurredAt: times[0] },
      { kind: "activity", activityId: meal, occurredAt: times[1] },
      { kind: "in", occurredAt: times[2] },
    ];
    for (const payload of payloads) {
      const res = await app.inject({
        method: "POST",
        url: `/api/presence/signals/${uid}`,
        headers: asUser(doorStaff),
        payload,
      });
      expect(res.statusCode).toBe(201);
    }
    const timeline = await app.inject({
      method: "GET",
      url: `/api/presence/timeline/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(timeline.json().conflicts).toHaveLength(0);
  });
});

describe("H24 timeline activity picker list", () => {
  it("offers only scannable activities, plus any this person already logged", async () => {
    const uid = await createUser();
    const { createActivity } = await import("./fixtures.js");
    const meal = await createMeal("Breakfast");
    const scannable = await createActivity({
      category: "activity",
      requiresScan: true,
      name: "Workshop",
    });
    await createActivity({ category: "activity", requiresScan: false, name: "Hidden" });
    const logged = await createActivity({
      category: "activity",
      requiresScan: false,
      name: "Already logged",
    });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO activity_logs (user_id, activity_id, logged_by, logged_at)
       VALUES ($1, $2, $3, now())`,
      [uid, logged, doorStaff],
    );

    const timeline = await app.inject({
      method: "GET",
      url: `/api/presence/timeline/${uid}`,
      headers: asUser(statsStaff),
    });
    expect(timeline.statusCode).toBe(200);
    const names = timeline.json().activities.map((a: { name: string }) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Breakfast", "Workshop", "Already logged"]));
    expect(names).not.toContain("Hidden");
    expect(timeline.json().activities.map((a: { id: number }) => a.id)).toEqual(
      expect.arrayContaining([meal, scannable, logged]),
    );
  });
});

describe("H24 event-end automatic exit (product override: the one system-closed out)", () => {
  it("closes open sessions at event_ends_at, audits them, and is idempotent", async () => {
    const uid = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const endedAt = new Date(Date.now() - 3_600_000); // event ended an hour ago
    const enteredAt = new Date(endedAt.getTime() - 5 * 3_600_000).toISOString();
    await app.inject({
      method: "POST",
      url: `/api/presence/signals/${uid}`,
      headers: asUser(doorStaff),
      payload: { kind: "in", occurredAt: enteredAt },
    });
    await pool.query(
      `INSERT INTO event_config (id, event_ends_at) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET event_ends_at = EXCLUDED.event_ends_at`,
      [endedAt],
    );

    const { runPresenceEventEndCloserOnce } = await import(
      "../../src/modules/logistics/presence-closer.js"
    );
    const first = await runPresenceEventEndCloserOnce();
    expect(first.closed).toEqual([uid]);

    const outs = await pool.query(
      `SELECT kind, scanned_at, scanned_by, notes FROM time_logs
        WHERE user_id = $1 AND kind = 'out'`,
      [uid],
    );
    expect(outs.rows).toHaveLength(1);
    expect(outs.rows[0].scanned_at.toISOString()).toBe(endedAt.toISOString());
    expect(outs.rows[0].scanned_by).toBeNull();
    expect(outs.rows[0].notes).toBe("Automatic exit at event end");

    const audits = await pool.query(
      `SELECT * FROM audit_log
        WHERE entity_type = 'presence' AND action = 'event_end_auto_exit' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);

    const again = await runPresenceEventEndCloserOnce();
    expect(again.closed).toEqual([]);
  });

  it("leaves sessions opened after event end and already-closed ones alone", async () => {
    const stillThere = await createUser();
    const wentHome = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const endedAt = new Date(Date.now() - 2 * 3_600_000);
    // teardown helper entered after the event officially ended
    await app.inject({
      method: "POST",
      url: `/api/presence/signals/${stillThere}`,
      headers: asUser(doorStaff),
      payload: { kind: "in", occurredAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    // this one entered and left properly before the end
    for (const payload of [
      { kind: "in", occurredAt: new Date(endedAt.getTime() - 4 * 3_600_000).toISOString() },
      { kind: "out", occurredAt: new Date(endedAt.getTime() - 3_600_000).toISOString() },
    ]) {
      await app.inject({
        method: "POST",
        url: `/api/presence/signals/${wentHome}`,
        headers: asUser(doorStaff),
        payload,
      });
    }
    await pool.query(
      `INSERT INTO event_config (id, event_ends_at) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET event_ends_at = EXCLUDED.event_ends_at`,
      [endedAt],
    );
    const { runPresenceEventEndCloserOnce } = await import(
      "../../src/modules/logistics/presence-closer.js"
    );
    const run = await runPresenceEventEndCloserOnce();
    expect(run.closed).toEqual([]);
  });
});
