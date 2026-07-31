import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { runAnnouncementsPublisherOnce } from "../../src/modules/notifications/announcements-publisher.js";
import { asUser, buildTestApp, createUser, createUserWithCapabilities } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * H50 announcements: capability-guarded CRUD with audit, the vigencia
 * window (publish_at/expires_at — DELTA(H50)), immediate + scheduled
 * fan-out, target_role filtering, and per-user read markers.
 */

let app: App;

beforeAll(async () => {
  app = await buildTestApp();
});

beforeEach(async () => {
  await resetNotificationsState();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function outboxRowsFor(category = "announcements") {
  const { rows } = await pool.query(
    `SELECT user_id, channel FROM notification_outbox WHERE category = $1 ORDER BY user_id, channel`,
    [category],
  );
  return rows as { user_id: number; channel: string }[];
}

describe("announcement CRUD (H50)", () => {
  it("is guarded by ANNOUNCEMENTS_MANAGE: 401 anon, 403 without capability", async () => {
    const anon = await app.inject({
      method: "POST",
      url: "/api/announcements",
      payload: { title: "t", body: "b" },
    });
    expect(anon.statusCode).toBe(401);

    const plebId = await createUser();
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(plebId),
      payload: { title: "t", body: "b" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("accepts the administrator wildcard for announcement management", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "Wildcard", body: "managed" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("create with no window fans out immediately (in_app+push) and audits (H53)", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const otherId = await createUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "Dinner is ready", body: "Go to the canteen" },
    });
    expect(res.statusCode).toBe(201);
    const announcement = res.json();
    expect(announcement.fanned_out_at).not.toBeNull();

    // fan-out: both users (target_role null = everyone), in_app + push each
    const rows = await outboxRowsFor();
    expect(rows).toEqual([
      { user_id: adminId, channel: "in_app" },
      { user_id: adminId, channel: "push" },
      { user_id: otherId, channel: "in_app" },
      { user_id: otherId, channel: "push" },
    ]);

    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'announcement' AND action = 'create'`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_id).toBe(adminId);
    expect(String(auditRows[0].entity_id)).toBe(String(announcement.id));
  });

  it("fan-out respects the 'announcements' preference category (H51)", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const quietId = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'announcements', 'push', false)`,
      [quietId],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "t", body: "b" },
    });
    expect(res.statusCode).toBe(201);

    const rows = await outboxRowsFor();
    const quietRows = rows.filter((r) => r.user_id === quietId);
    expect(quietRows).toEqual([{ user_id: quietId, channel: "in_app" }]);
  });

  it("update and delete are audited", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: asUser(adminId),
        payload: { title: "before", body: "b" },
      })
    ).json();

    const updated = await app.inject({
      method: "PUT",
      url: `/api/announcements/${created.id}`,
      headers: asUser(adminId),
      payload: { title: "after" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().title).toBe("after");
    expect(updated.json().body).toBe("b"); // partial update keeps the rest

    const del = await app.inject({
      method: "DELETE",
      url: `/api/announcements/${created.id}`,
      headers: asUser(adminId),
    });
    expect(del.statusCode).toBe(200);

    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'announcement' ORDER BY id`,
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "delete"]);

    const gone = await app.inject({
      method: "GET",
      url: `/api/announcements/${created.id}`,
      headers: asUser(adminId),
    });
    expect(gone.statusCode).toBe(404);
  });
});

describe("visibility window (H50 vigencia — DELTA expires_at)", () => {
  it("public feed only returns announcements inside their window", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const make = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/announcements", headers: asUser(adminId), payload });

    await make({ title: "active", body: "b", publishAt: iso(-60_000), expiresAt: iso(60_000) });
    await make({ title: "no-window", body: "b" });
    await make({ title: "future", body: "b", publishAt: iso(60_000) });
    await make({ title: "expired", body: "b", publishAt: iso(-120_000), expiresAt: iso(-60_000) });

    const publicRes = await app.inject({ method: "GET", url: "/api/announcements/public" });
    expect(publicRes.statusCode).toBe(200);
    const titles = publicRes.json().items.map((a: { title: string }) => a.title);
    expect(titles.sort()).toEqual(["active", "no-window"]);

    // admin list still sees everything
    const adminRes = await app.inject({
      method: "GET",
      url: "/api/announcements",
      headers: asUser(adminId),
    });
    expect(adminRes.json().items).toHaveLength(4);
  });

  it("future publish_at defers fan-out to the publisher; it fans out exactly once", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    await createUser();

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: asUser(adminId),
        payload: { title: "scheduled", body: "b", publishAt: iso(60_000) },
      })
    ).json();

    expect(created.fanned_out_at).toBeNull();
    expect(await outboxRowsFor()).toHaveLength(0);

    // not due yet
    expect((await runAnnouncementsPublisherOnce()).published).toBe(0);

    // cross into the window
    await pool.query(`UPDATE announcements SET publish_at = now() WHERE id = $1`, [created.id]);
    expect((await runAnnouncementsPublisherOnce()).published).toBe(1);
    const afterFirst = await outboxRowsFor();
    expect(afterFirst.length).toBeGreaterThan(0);

    // second poll must not fan out again
    expect((await runAnnouncementsPublisherOnce()).published).toBe(0);
    expect(await outboxRowsFor()).toHaveLength(afterFirst.length);
  });

  it("an already-expired announcement never fans out", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: asUser(adminId),
        payload: {
          title: "too late",
          body: "b",
          publishAt: iso(-120_000),
          expiresAt: iso(-60_000),
        },
      })
    ).json();

    expect(created.fanned_out_at).toBeNull();
    await runAnnouncementsPublisherOnce();
    expect(await outboxRowsFor()).toHaveLength(0);
  });
});

describe("target_role (MVP simplification, documented in announcements-service.ts)", () => {
  it("'participant' targets confirmed applications / submission members only", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const participantId = await createUser();
    const bystanderId = await createUser();

    const { rows: appRows } = await pool.query(
      `INSERT INTO applications (name, type, template) VALUES ('hackers', 'participant', '{}') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status) VALUES ($1, $2, 'confirmed')`,
      [participantId, appRows[0].id],
    );

    await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "hackers only", body: "b", targetRole: "participant" },
    });

    const rows = await outboxRowsFor();
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    expect(userIds).toEqual([participantId]);
    expect(userIds).not.toContain(bystanderId);
    expect(userIds).not.toContain(adminId);
  });
});

describe("read markers (announcement_reads)", () => {
  it("marks read idempotently and 404s on unknown announcements", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const userId = await createUser();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: asUser(adminId),
        payload: { title: "t", body: "b" },
      })
    ).json();

    const first = await app.inject({
      method: "POST",
      url: `/api/announcements/${created.id}/read`,
      headers: asUser(userId),
    });
    expect(first.statusCode).toBe(200);

    const again = await app.inject({
      method: "POST",
      url: `/api/announcements/${created.id}/read`,
      headers: asUser(userId),
    });
    expect(again.statusCode).toBe(200);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM announcement_reads WHERE announcement_id = $1 AND user_id = $2`,
      [created.id, userId],
    );
    expect(rows[0].n).toBe(1);

    const missing = await app.inject({
      method: "POST",
      url: "/api/announcements/999999/read",
      headers: asUser(userId),
    });
    expect(missing.statusCode).toBe(404);
  });
});
