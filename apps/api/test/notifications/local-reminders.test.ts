import "./env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { runScheduleRemindersOnce } from "../../src/modules/notifications/schedule-reminders.js";
import { asUser, buildTestApp, createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** Phones schedule activity reminders themselves; the server push is only the fallback (H51, H59). */

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

const LEAD = 15;

async function dueItem(): Promise<{ id: number; startsAtMs: number }> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ('Workshop', now() + interval '5 minutes', now() + interval '65 minutes', 'shown', ARRAY['participant'])
     RETURNING id, starts_at`,
  );
  return { id: rows[0].id, startsAtMs: rows[0].starts_at.getTime() };
}

async function subscribedUser(token: string) {
  const userId = await createUser();
  await pool.query(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, 'ios')`, [
    userId,
    token,
  ]);
  return userId;
}

async function optIn(userId: number, scheduleId: number) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, 'in_app', true)`,
    [userId, `schedule:${scheduleId}`],
  );
}

function report(userId: number, token: string, items: unknown[], leadMinutes = LEAD) {
  return app.inject({
    method: "PUT",
    url: "/api/me/local-reminders",
    headers: asUser(userId),
    payload: { token, leadMinutes, items },
  });
}

async function channelsFor(userId: number): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT channel FROM notification_outbox WHERE user_id = $1 AND category LIKE 'schedule:%' ORDER BY channel`,
    [userId],
  );
  return rows.map((row) => row.channel);
}

describe("device-local activity reminders", () => {
  it("exposes the event reminder settings to any signed-in account", async () => {
    const userId = await createUser();
    const response = await app.inject({
      method: "GET",
      url: "/api/me/reminder-settings",
      headers: asUser(userId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, leadMinutes: LEAD });
    expect((await app.inject({ method: "GET", url: "/api/me/reminder-settings" })).statusCode).toBe(
      401,
    );
  });

  it("rejects a report for a token the account does not own", async () => {
    const owner = await subscribedUser("ExponentPushToken[owner]");
    const other = await createUser();
    expect((await report(other, "ExponentPushToken[owner]", [])).statusCode).toBe(404);
    expect((await report(owner, "ExponentPushToken[owner]", [])).statusCode).toBe(200);
  });

  it("still pushes when the device reports nothing (server fallback)", async () => {
    const item = await dueItem();
    const userId = await subscribedUser("ExponentPushToken[a]");
    await optIn(userId, item.id);
    await runScheduleRemindersOnce();
    expect(await channelsFor(userId)).toContain("push");
  });

  it("skips only the push channel for a fully covered user", async () => {
    const item = await dueItem();
    const userId = await subscribedUser("ExponentPushToken[a]");
    await optIn(userId, item.id);
    expect((await report(userId, "ExponentPushToken[a]", [item])).statusCode).toBe(200);
    await runScheduleRemindersOnce();
    const channels = await channelsFor(userId);
    expect(channels).not.toContain("push");
    expect(channels).toContain("in_app");
  });

  it.each([
    [
      "a different start time",
      (item: { id: number; startsAtMs: number }) => [
        { id: item.id, startsAtMs: item.startsAtMs + 60_000 },
      ],
      LEAD,
    ],
    [
      "another item",
      (item: { id: number; startsAtMs: number }) => [
        { id: item.id + 100, startsAtMs: item.startsAtMs },
      ],
      LEAD,
    ],
    ["another lead", (item: { id: number; startsAtMs: number }) => [item], LEAD + 5],
  ])("keeps the push when the device reports %s", async (_name, items, lead) => {
    const item = await dueItem();
    const userId = await subscribedUser("ExponentPushToken[a]");
    await optIn(userId, item.id);
    await report(userId, "ExponentPushToken[a]", items(item), lead);
    await runScheduleRemindersOnce();
    expect(await channelsFor(userId)).toContain("push");
  });

  it("keeps the push when the report is stale", async () => {
    const item = await dueItem();
    const userId = await subscribedUser("ExponentPushToken[a]");
    await optIn(userId, item.id);
    await report(userId, "ExponentPushToken[a]", [item]);
    await pool.query(
      `UPDATE push_tokens SET local_reminders_synced_at = now() - interval '3 days'`,
    );
    await runScheduleRemindersOnce();
    expect(await channelsFor(userId)).toContain("push");
  });

  it("keeps the push while any of the user's devices is not covered", async () => {
    const item = await dueItem();
    const userId = await subscribedUser("ExponentPushToken[a]");
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, 'android')`,
      [userId, "ExponentPushToken[b]"],
    );
    await optIn(userId, item.id);
    await report(userId, "ExponentPushToken[a]", [item]);
    await runScheduleRemindersOnce();
    expect(await channelsFor(userId)).toContain("push");
  });
});
