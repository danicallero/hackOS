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
 * window (publish_at/expires_at — DELTA(H50)), explicit notification delivery,
 * translations, screen placement, and per-user read markers.
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

async function broadcastCount(topic: string): Promise<number> {
  const { valkey } = await import("../../src/lib/valkey.js");
  const value = await valkey.get(`sse:seq:${topic}`);
  return value ? Number(value) : 0;
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

  it("creates without notifying by default and audits (H53)", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    await createUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "Dinner is ready", body: "Go to the canteen" },
    });
    expect(res.statusCode).toBe(201);
    const announcement = res.json();
    expect(announcement.fanned_out_at).toBeNull();
    expect(announcement.notify_users).toBe(false);
    expect(announcement.screen_placement).toBe("none");

    expect(await outboxRowsFor()).toEqual([]);

    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'announcement' AND action = 'create'`,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].actor_id).toBe(adminId);
    expect(String(auditRows[0].entity_id)).toBe(String(announcement.id));
  });

  it("notifies every account through inbox, email and push while respecting preferences (H51)", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const quietId = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'announcements', 'push', false)`,
      [quietId],
    );
    await pool.query(`UPDATE users SET language = 'gl' WHERE id = $1`, [quietId]);

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "t",
        body: "b",
        notifyUsers: true,
        screenPlacement: "embedded",
        translations: {
          es: { title: "es", body: "cuerpo es" },
          gl: { title: "gl", body: "corpo gl" },
          en: { title: "en", body: "body en" },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().fanned_out_at).not.toBeNull();
    expect(res.json().screen_placement).toBe("embedded");

    const rows = await outboxRowsFor();
    const quietRows = rows.filter((r) => r.user_id === quietId);
    expect(quietRows).toEqual([
      { user_id: quietId, channel: "in_app" },
      { user_id: quietId, channel: "email" },
    ]);
    expect(rows.filter((r) => r.user_id === adminId)).toEqual([
      { user_id: adminId, channel: "in_app" },
      { user_id: adminId, channel: "email" },
      { user_id: adminId, channel: "push" },
    ]);

    const { rows: payloadRows } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1 AND channel = 'in_app'`,
      [adminId],
    );
    expect(payloadRows[0].payload).toMatchObject({ subject: "en", body: "body en" });
    const { rows: galicianPayloadRows } = await pool.query(
      `SELECT payload FROM notification_outbox WHERE user_id = $1 AND channel = 'in_app'`,
      [quietId],
    );
    expect(galicianPayloadRows[0].payload).toMatchObject({ subject: "gl", body: "corpo gl" });
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

    const contentBroadcasts = await broadcastCount("content");
    const del = await app.inject({
      method: "DELETE",
      url: `/api/announcements/${created.id}`,
      headers: asUser(adminId),
    });
    expect(del.statusCode).toBe(200);
    expect(await broadcastCount("content")).toBe(contentBroadcasts + 1);

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

    await make({
      title: "active",
      body: "b",
      screenPlacement: "fullscreen",
      publishAt: iso(-60_000),
      expiresAt: iso(60_000),
    });
    await make({ title: "no-window", body: "b" });
    await make({ title: "future", body: "b", publishAt: iso(60_000) });
    await make({ title: "expired", body: "b", publishAt: iso(-120_000), expiresAt: iso(-60_000) });

    const publicRes = await app.inject({ method: "GET", url: "/api/announcements/public" });
    expect(publicRes.statusCode).toBe(200);
    const titles = publicRes.json().items.map((a: { title: string }) => a.title);
    expect(titles.sort()).toEqual(["active", "no-window"]);
    expect(publicRes.json().items[0]).toMatchObject({
      screenPlacement: expect.any(String),
      publishAt: expect.anything(),
      translations: {},
    });
    expect(publicRes.json().items[0]).not.toHaveProperty("author_id");
    expect(publicRes.json().items[0]).not.toHaveProperty("notify_users");
    expect(publicRes.json().items[0]).not.toHaveProperty("fanned_out_at");

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
        payload: { title: "scheduled", body: "b", notifyUsers: true, publishAt: iso(60_000) },
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
          // expires_at only stays meaningful for screen-placed rows (H50,
          // DELTA 0722) — a notify-only row can't carry one at all.
          screenPlacement: "fullscreen",
          publishAt: iso(-120_000),
          expiresAt: iso(-60_000),
          notifyUsers: true,
        },
      })
    ).json();

    expect(created.fanned_out_at).toBeNull();
    await runAnnouncementsPublisherOnce();
    expect(await outboxRowsFor()).toHaveLength(0);
  });
});

describe("announcement delivery controls", () => {
  it("does not accept an audience field and reaches every account when delivery is selected", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const firstUserId = await createUser();
    const secondUserId = await createUser();

    const obsoleteAudience = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "all accounts", body: "b", notifyUsers: true, targetRole: "participant" },
    });
    expect(obsoleteAudience.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "all accounts", body: "b", notifyUsers: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).not.toHaveProperty("target_role");

    const rows = await outboxRowsFor();
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    expect(userIds).toEqual([adminId, firstUserId, secondUserId]);
  });
});

async function makeAttendee(role: "participant" | "mentor"): Promise<number> {
  const userId = await createUser();
  await pool.query(`INSERT INTO manual_attendee_roles (user_id, role) VALUES ($1, $2)`, [
    userId,
    role,
  ]);
  return userId;
}

async function makeSponsor(): Promise<number> {
  const userId = await createUser();
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
    rows[0].id,
    userId,
  ]);
  return userId;
}

describe("audience and recipient targeting (H50, DELTA 0722)", () => {
  it("an audience-tagged announcement only reaches matching accounts (sponsor implies participant)", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const mentorId = await makeAttendee("mentor");
    const participantId = await makeAttendee("participant");
    const sponsorId = await makeSponsor();
    await createUser(); // unaffiliated account, should never be reached

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "mentors only", body: "b", notifyUsers: true, audiences: ["mentor"] },
    });
    expect(res.statusCode).toBe(201);

    const userIds = [...new Set((await outboxRowsFor()).map((r) => r.user_id))];
    expect(userIds).toEqual([mentorId]);
    expect(userIds).not.toContain(participantId);
    expect(userIds).not.toContain(sponsorId);

    const participantAudience = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "participants and sponsors",
        body: "b",
        notifyUsers: true,
        audiences: ["participant"],
      },
    });
    expect(participantAudience.statusCode).toBe(201);
    const secondRoundUserIds = [
      ...new Set((await outboxRowsFor()).map((r) => r.user_id).filter((id) => id !== mentorId)),
    ];
    expect(secondRoundUserIds.sort()).toEqual([participantId, sponsorId].sort());
  });

  it("a staff-audience announcement reaches every capability holder, including via a nested group", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const staffId = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    await makeAttendee("participant"); // plain participant, not staff

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: { title: "staff only", body: "b", notifyUsers: true, audiences: ["staff"] },
    });
    expect(res.statusCode).toBe(201);

    const userIds = [...new Set((await outboxRowsFor()).map((r) => r.user_id))].sort();
    expect(userIds).toEqual([adminId, staffId].sort());
  });

  it("a specific-recipient announcement only reaches the listed accounts", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const targetId = await createUser();
    await createUser(); // not targeted

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "just you",
        body: "b",
        notifyUsers: true,
        recipientUserIds: [targetId],
      },
    });
    expect(res.statusCode).toBe(201);

    const userIds = [...new Set((await outboxRowsFor()).map((r) => r.user_id))];
    expect(userIds).toEqual([targetId]);
  });

  it("rejects an audience together with specific recipients", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const targetId = await createUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "both",
        body: "b",
        notifyUsers: true,
        audiences: ["mentor"],
        recipientUserIds: [targetId],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects expiresAt on a notify-only announcement", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "no window",
        body: "b",
        notifyUsers: true,
        screenPlacement: "none",
        expiresAt: iso(60_000),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects specific recipients on a screen-placed announcement", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const targetId = await createUser();
    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "on screen",
        body: "b",
        screenPlacement: "embedded",
        recipientUserIds: [targetId],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("filters candidate channels through each recipient's own preferences, never bypassing them", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const pushOffId = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'announcements', 'push', false)`,
      [pushOffId],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/announcements",
      headers: asUser(adminId),
      payload: {
        title: "push only",
        body: "b",
        notifyUsers: true,
        channels: ["push"],
        recipientUserIds: [pushOffId],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(await outboxRowsFor()).toEqual([]);
  });

  it("recipient-candidates search is scoped to ANNOUNCEMENTS_MANAGE, not the broader USERS_READ", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    const targetId = await createUser({ name: "Findable Person" });
    await createUser({ name: "Someone Else" });

    const anon = await app.inject({
      method: "GET",
      url: "/api/announcements/recipient-candidates?q=Findable",
    });
    expect(anon.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/announcements/recipient-candidates?q=Findable",
      headers: asUser(await createUser()),
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "GET",
      url: "/api/announcements/recipient-candidates?q=Findable",
      headers: asUser(adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users.map((u: { id: number }) => u.id)).toEqual([targetId]);
  });

  it("a screen+notify announcement fans out exactly once and keeps its screen window independent of the fan-out", async () => {
    const adminId = await createUserWithCapabilities([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    await createUser();

    const created = (
      await app.inject({
        method: "POST",
        url: "/api/announcements",
        headers: asUser(adminId),
        payload: {
          title: "screen + notify",
          body: "b",
          screenPlacement: "embedded",
          notifyUsers: true,
          publishAt: iso(60_000),
          expiresAt: iso(120_000),
        },
      })
    ).json();
    expect(created.fanned_out_at).toBeNull();

    expect((await runAnnouncementsPublisherOnce()).published).toBe(0);

    await pool.query(
      `UPDATE announcements SET publish_at = now() - interval '1 second' WHERE id = $1`,
      [created.id],
    );
    expect((await runAnnouncementsPublisherOnce()).published).toBe(1);
    const afterFirst = await outboxRowsFor();
    expect(afterFirst.length).toBeGreaterThan(0);

    // still on-screen (window hasn't expired) but must not fan out again
    expect((await runAnnouncementsPublisherOnce()).published).toBe(0);
    expect(await outboxRowsFor()).toHaveLength(afterFirst.length);

    const publicRes = await app.inject({ method: "GET", url: "/api/announcements/public" });
    expect(publicRes.json().items.map((a: { id: number }) => a.id)).toContain(created.id);
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
