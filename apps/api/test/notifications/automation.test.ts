import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser, createUserWithCapabilities } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/** Organizer switch and lead of the automatic schedule reminder (H45, H51, H53). */

let app: App;

beforeEach(async () => {
  await resetNotificationsState();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

const url = "/api/notifications/automation";
const get = (userId: number) => app.inject({ method: "GET", url, headers: asUser(userId) });
const put = (userId: number, payload: Record<string, unknown>) =>
  app.inject({ method: "PUT", url, headers: asUser(userId), payload });
const stored = async () =>
  (
    await pool.query(
      `SELECT schedule_reminders_enabled AS enabled, schedule_reminder_lead_minutes AS lead
         FROM notification_automation_settings WHERE id = 1`,
    )
  ).rows[0];

async function scheduleItemIn(minutes: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
     VALUES ('Talk', now() + make_interval(mins => $1), now() + make_interval(mins => $1 + 60),
             'shown', ARRAY['participant'])
     RETURNING id`,
    [minutes],
  );
  return rows[0].id;
}

async function optIn(userId: number, scheduleId: number) {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, 'in_app', true)`,
    [userId, `schedule:${scheduleId}`],
  );
}

describe("automatic notification settings", () => {
  it("require a session and the event-settings capability", async () => {
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const outsider = await createUserWithCapabilities([CAPABILITIES.NOTIFICATIONS_SEND]);
    expect((await get(outsider)).statusCode).toBe(403);
    expect((await put(outsider, { scheduleRemindersEnabled: false })).statusCode).toBe(403);
  });

  it("read the defaults and store only intentional overrides (R018), audited", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    expect((await get(admin)).json()).toEqual({
      scheduleRemindersEnabled: true,
      scheduleReminderLeadMinutes: 15,
      defaultScheduleReminderLeadMinutes: 15,
      scheduleReminderLeadCustom: false,
    });

    const off = await put(admin, { scheduleRemindersEnabled: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({
      scheduleRemindersEnabled: false,
      scheduleReminderLeadCustom: false,
    });
    expect(await stored()).toEqual({ enabled: false, lead: null });

    const lead = await put(admin, { scheduleReminderLeadMinutes: 45 });
    expect(lead.json()).toMatchObject({
      scheduleRemindersEnabled: false,
      scheduleReminderLeadMinutes: 45,
      scheduleReminderLeadCustom: true,
    });
    expect(await stored()).toEqual({ enabled: false, lead: 45 });

    // Typing the default, or null, goes back to "no override".
    await put(admin, { scheduleReminderLeadMinutes: 15 });
    expect((await stored()).lead).toBeNull();
    await put(admin, { scheduleReminderLeadMinutes: 45 });
    const reset = await put(admin, { scheduleReminderLeadMinutes: null });
    expect(reset.json()).toMatchObject({
      scheduleReminderLeadMinutes: 15,
      scheduleReminderLeadCustom: false,
    });
    expect((await stored()).lead).toBeNull();

    const { rows } = await pool.query(
      `SELECT actor_id, before, after FROM audit_log
        WHERE entity_type = 'notification_automation_settings' ORDER BY id`,
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ actor_id: admin });
    expect(rows[0].before.scheduleRemindersEnabled).toBe(true);
    expect(rows[0].after.scheduleRemindersEnabled).toBe(false);
    expect(rows[1].after.scheduleReminderLeadMinutes).toBe(45);
  });

  it("validate the lead between 1 and 1440 minutes", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    for (const scheduleReminderLeadMinutes of [0, 1441, 1.5, "15"]) {
      expect((await put(admin, { scheduleReminderLeadMinutes })).statusCode).toBe(400);
    }
    expect((await put(admin, { unknown: true })).statusCode).toBe(400);
    for (const scheduleReminderLeadMinutes of [1, 1440]) {
      expect((await put(admin, { scheduleReminderLeadMinutes })).statusCode).toBe(200);
    }
  });
});

describe("schedule reminder job honours the settings", () => {
  async function run() {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    return runScheduleRemindersOnce();
  }

  it("uses the configured lead instead of 15 minutes", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const userId = await createUser();
    const item = await scheduleItemIn(40);
    await optIn(userId, item);

    expect((await run()).reminded).toBe(0);
    await put(admin, { scheduleReminderLeadMinutes: 60 });
    expect(await run()).toMatchObject({ reminded: 1, notified: 1 });

    // A shorter lead leaves a later item for later.
    const later = await scheduleItemIn(20);
    await put(admin, { scheduleReminderLeadMinutes: 5 });
    expect((await run()).reminded).toBe(0);
    await put(admin, { scheduleReminderLeadMinutes: null });
    expect(await run()).toMatchObject({ reminded: 0 });
    await put(admin, { scheduleReminderLeadMinutes: 30 });
    expect(await run()).toMatchObject({ reminded: 1 });
    const { rows } = await pool.query(`SELECT reminded_at FROM schedule WHERE id = $1`, [later]);
    expect(rows[0].reminded_at).not.toBeNull();
  });

  it("sends nothing while switched off and resumes when switched on", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const userId = await createUser();
    const item = await scheduleItemIn(10);
    await optIn(userId, item);

    await put(admin, { scheduleRemindersEnabled: false });
    expect(await run()).toEqual({ reminded: 0, notified: 0 });
    const { rows } = await pool.query(`SELECT reminded_at FROM schedule WHERE id = $1`, [item]);
    expect(rows[0].reminded_at).toBeNull();

    await put(admin, { scheduleRemindersEnabled: true });
    expect(await run()).toMatchObject({ reminded: 1, notified: 1 });
  });
});
