import "./env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { notify } from "../../src/modules/notifications/service.js";
import { assignRole, asUser, buildTestApp, createRole, createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * Email is opt-in for queue, activity-reminder and challenge notices, and a
 * mobile device replaces it (H51, H52): the email default is "only people
 * without a registered push token", queue can never leave anyone unreachable,
 * and event-access users are asked once on first run.
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

async function addDevice(userId: number, token = `ExponentPushToken[${userId}]`) {
  await pool.query(`INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)`, [userId, token]);
}

async function setPref(userId: number, category: string, channel: string, enabled: boolean) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, $3, $4)`,
    [userId, category, channel, enabled],
  );
}

async function channelsFor(userId: number, category: string): Promise<string[]> {
  await notify(pool, { userId, category, payload: { subject: "s", body: "b" } });
  const { rows } = await pool.query(
    `SELECT channel FROM notification_outbox WHERE user_id = $1 ORDER BY channel`,
    [userId],
  );
  return rows.map((r) => r.channel);
}

describe.each(["queue", "challenge", "schedule"])("email default for %s", (category) => {
  it("goes to email when the person has no mobile device", async () => {
    const userId = await createUser();
    expect(await channelsFor(userId, category)).toEqual(["in_app", "email", "push"]);
  });

  it("is replaced by push once a device is registered", async () => {
    const userId = await createUser();
    await addDevice(userId);
    expect(await channelsFor(userId, category)).toEqual(["in_app", "push"]);
  });

  it("stays on with a device when the person chose email", async () => {
    const userId = await createUser();
    await addDevice(userId);
    await setPref(userId, category, "email", true);
    expect(await channelsFor(userId, category)).toEqual(["in_app", "email", "push"]);
  });
});

describe("queue is always reachable", () => {
  it("keeps email without a device even if it was switched off", async () => {
    const userId = await createUser();
    await setPref(userId, "queue", "email", false);
    expect(await channelsFor(userId, "queue")).toEqual(["in_app", "email", "push"]);
  });

  it("returns to email when the device is gone (signed out)", async () => {
    const userId = await createUser();
    await addDevice(userId, "ExponentPushToken[out]");
    await setPref(userId, "queue", "email", false);
    expect(await channelsFor(userId, "queue")).toEqual(["in_app", "push"]);

    const res = await app.inject({
      method: "POST",
      url: "/api/me/push-tokens/unregister",
      headers: asUser(userId),
      payload: { token: "ExponentPushToken[out]" },
    });
    expect(res.statusCode).toBe(200);
    await pool.query(`DELETE FROM notification_outbox`);
    expect(await channelsFor(userId, "queue")).toEqual(["in_app", "email", "push"]);
  });

  it("does not let one person unregister another's token", async () => {
    const owner = await createUser();
    const other = await createUser();
    await addDevice(owner, "ExponentPushToken[owner]");
    await app.inject({
      method: "POST",
      url: "/api/me/push-tokens/unregister",
      headers: asUser(other),
      payload: { token: "ExponentPushToken[owner]" },
    });
    const { rows } = await pool.query(`SELECT 1 FROM push_tokens WHERE user_id = $1`, [owner]);
    expect(rows).toHaveLength(1);
  });

  it("accepts a queue email choice but still rejects other queue overrides", async () => {
    const userId = await createUser();
    const ok = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: { preferences: [{ category: "queue", channel: "email", enabled: true }] },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await app.inject({
      method: "PUT",
      url: "/api/me/notification-preferences",
      headers: asUser(userId),
      payload: { preferences: [{ category: "queue", channel: "push", enabled: false }] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("first-run onboarding", () => {
  async function withEventAccess(userId: number) {
    await assignRole(userId, await createRole([], { eventAccess: true }));
  }

  it("is required only for people with event access, until completed", async () => {
    const plain = await createUser();
    const attendee = await createUser();
    await withEventAccess(attendee);

    const get = (id: number) =>
      app.inject({
        method: "GET",
        url: "/api/me/notification-preferences",
        headers: asUser(id),
      });
    expect((await get(plain)).json().onboardingRequired).toBe(false);
    const before = (await get(attendee)).json();
    expect(before.onboardingRequired).toBe(true);
    expect(before.hasPushDevice).toBe(false);

    const done = await app.inject({
      method: "POST",
      url: "/api/me/notification-preferences/onboarding",
      headers: asUser(attendee),
      payload: { preferences: [{ category: "queue", channel: "email", enabled: true }] },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().onboardingRequired).toBe(false);
    expect(done.json().overrides).toEqual([{ category: "queue", channel: "email", enabled: true }]);

    // Idempotent: a second device completing it again keeps it done.
    const again = await app.inject({
      method: "POST",
      url: "/api/me/notification-preferences/onboarding",
      headers: asUser(attendee),
      payload: { preferences: [] },
    });
    expect(again.statusCode).toBe(200);
    expect((await get(attendee)).json().onboardingRequired).toBe(false);
  });
});
