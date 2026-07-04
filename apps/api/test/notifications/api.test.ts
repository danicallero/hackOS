import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { audit } from "../../src/lib/audit.js";
import { notify } from "../../src/modules/notifications/service.js";
import { asUser, buildTestApp, createUser, createUserWithCapabilities } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** H51 preference API, in-app inbox API, and the H53 audit surface. */

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

describe("notification preferences (H51)", () => {
  it("requires auth and starts with an empty override matrix", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/api/me/notification-preferences" })).statusCode,
    ).toBe(401);

    const userId = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      channels: ["in_app", "email", "push", "discord"],
      mandatoryCategories: ["queue"],
      overrides: [],
    });
  });

  it("PUT stores overrides and upserts on repeat", async () => {
    const userId = await createUser();
    const put = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: {
        preferences: [{ category: "announcements", channel: "email", enabled: false }],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().overrides).toEqual([
      { category: "announcements", channel: "email", enabled: false },
    ]);

    // flip it back — upsert, not duplicate
    const flip = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: {
        preferences: [{ category: "announcements", channel: "email", enabled: true }],
      },
    });
    expect(flip.json().overrides).toEqual([
      { category: "announcements", channel: "email", enabled: true },
    ]);
  });

  it("rejects overriding the mandatory 'queue' category with 400 (H51)", async () => {
    const userId = await createUser();
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: { preferences: [{ category: "queue", channel: "push", enabled: false }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("activity reminder opt-in is a schedule:<id> preference row (contract for the schedule WS)", async () => {
    const userId = await createUser();
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: {
        preferences: [
          { category: "schedule:42", channel: "push", enabled: true },
          { category: "schedule:42", channel: "email", enabled: true },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT channel FROM notification_preferences WHERE user_id = $1 AND category = 'schedule:42' ORDER BY channel`,
      [userId],
    );
    expect(rows.map((r) => r.channel)).toEqual(["email", "push"]);
  });
});

describe("in-app inbox (H50/H51)", () => {
  it("paginates, filters unread, and marks read", async () => {
    const userId = await createUser();
    for (let i = 0; i < 3; i += 1) {
      await notify(pool, {
        userId,
        category: "announcements",
        channels: ["in_app"],
        payload: { subject: `n${i}`, body: "b" },
      });
    }

    const page = await app.inject({
      method: "GET",
      url: "/api/me/notifications?limit=2",
      headers: asUser(userId),
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().total).toBe(3);
    expect(page.json().items).toHaveLength(2);
    // newest first
    expect(page.json().items[0].payload.subject).toBe("n2");

    const firstId = page.json().items[0].id;
    const read = await app.inject({
      method: "POST",
      url: `/api/me/notifications/${firstId}/read`,
      headers: asUser(userId),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().read_at).not.toBeNull();

    const unread = await app.inject({
      method: "GET",
      url: "/api/me/notifications?unread=true",
      headers: asUser(userId),
    });
    expect(unread.json().total).toBe(2);
    expect(unread.json().items.every((i: { id: number }) => i.id !== firstId)).toBe(true);

    // marking read twice keeps the original timestamp (COALESCE)
    const again = await app.inject({
      method: "POST",
      url: `/api/me/notifications/${firstId}/read`,
      headers: asUser(userId),
    });
    expect(again.json().read_at).toBe(read.json().read_at);
  });

  it("cannot read or mark another user's notifications", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const [id] = await notify(pool, {
      userId: owner,
      category: "announcements",
      channels: ["in_app"],
      payload: { subject: "private", body: "b" },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/me/notifications",
      headers: asUser(intruder),
    });
    expect(list.json().total).toBe(0);

    const mark = await app.inject({
      method: "POST",
      url: `/api/me/notifications/${id}/read`,
      headers: asUser(intruder),
    });
    expect(mark.statusCode).toBe(404);
  });

  it("email/push outbox rows never appear in the inbox", async () => {
    const userId = await createUser();
    await notify(pool, {
      userId,
      category: "queue",
      channels: ["email", "push"],
      payload: { subject: "not-inbox", body: "b" },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/me/notifications",
      headers: asUser(userId),
    });
    expect(res.json().total).toBe(0);
  });
});

describe("audit surface (H53)", () => {
  it("requires AUDIT_READ", async () => {
    expect((await app.inject({ method: "GET", url: "/api/audit" })).statusCode).toBe(401);
    const plebId = await createUser();
    expect(
      (await app.inject({ method: "GET", url: "/api/audit", headers: asUser(plebId) })).statusCode,
    ).toBe(403);
  });

  it("filters by entity, actor, action and date range with pagination", async () => {
    const readerId = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
    const actorA = await createUser();
    const actorB = await createUser();

    await audit(pool, { actorId: actorA, entityType: "badge", entityId: 1, action: "rotate" });
    await audit(pool, { actorId: actorA, entityType: "badge", entityId: 2, action: "assign" });
    await audit(pool, {
      actorId: actorB,
      entityType: "announcement",
      entityId: 9,
      action: "create",
    });

    const byType = await app.inject({
      method: "GET",
      url: "/api/audit?entityType=badge",
      headers: asUser(readerId),
    });
    expect(byType.json().total).toBe(2);

    const byActor = await app.inject({
      method: "GET",
      url: `/api/audit?actorId=${actorB}`,
      headers: asUser(readerId),
    });
    expect(byActor.json().total).toBe(1);
    expect(byActor.json().items[0].entity_type).toBe("announcement");

    const byAction = await app.inject({
      method: "GET",
      url: "/api/audit?entityType=badge&action=rotate",
      headers: asUser(readerId),
    });
    expect(byAction.json().total).toBe(1);
    expect(byAction.json().items[0].entity_id).toBe("1");

    const byEntityId = await app.inject({
      method: "GET",
      url: "/api/audit?entityType=badge&entityId=2",
      headers: asUser(readerId),
    });
    expect(byEntityId.json().total).toBe(1);

    const paged = await app.inject({
      method: "GET",
      url: "/api/audit?limit=2&offset=2",
      headers: asUser(readerId),
    });
    expect(paged.json().total).toBe(3);
    expect(paged.json().items).toHaveLength(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    const outOfRange = await app.inject({
      method: "GET",
      url: `/api/audit?dateFrom=${encodeURIComponent(future)}`,
      headers: asUser(readerId),
    });
    expect(outOfRange.json().total).toBe(0);

    const past = new Date(Date.now() - 60_000).toISOString();
    const inRange = await app.inject({
      method: "GET",
      url: `/api/audit?dateFrom=${encodeURIComponent(past)}&dateTo=${encodeURIComponent(future)}`,
      headers: asUser(readerId),
    });
    expect(inRange.json().total).toBe(3);
  });
});
