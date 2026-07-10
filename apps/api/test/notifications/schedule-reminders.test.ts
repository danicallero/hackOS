import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createUser } from "../helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * Activity reminder job (H51 "recordatorios de actividades concretas del
 * horario"; issue #80). Covers the due/retry/concurrent/expired/no-recipient
 * matrix the issue's AC calls out, mirroring
 * test/notifications/dispatcher.test.ts's style for the concurrency case.
 */

beforeEach(async () => {
  await resetNotificationsState();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function createScheduleItem(startsAt: Date): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility)
     VALUES ($1, $2::timestamptz, $2::timestamptz + interval '1 hour', 'shown')
     RETURNING id`,
    [`Activity ${crypto.randomUUID()}`, startsAt],
  );
  return rows[0].id;
}

async function optIn(userId: number, scheduleId: number, channel: string): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, $3, true)`,
    [userId, `schedule:${scheduleId}`, channel],
  );
}

async function outboxCount(scheduleId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM notification_outbox WHERE category = $1`,
    [`schedule:${scheduleId}`],
  );
  return rows[0].n;
}

async function remindedAt(scheduleId: number): Promise<Date | null> {
  const { rows } = await pool.query(`SELECT reminded_at FROM schedule WHERE id = $1`, [scheduleId]);
  return rows[0].reminded_at;
}

describe("schedule reminders (H51, issue #80)", () => {
  it("due: opted-in user gets exactly one reminder on the channels they chose", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
    const userId = await createUser();
    await optIn(userId, scheduleId, "push");

    const result = await runScheduleRemindersOnce();
    expect(result.reminded).toBe(1);
    expect(result.notified).toBe(1);

    const { rows } = await pool.query(
      `SELECT user_id, channel FROM notification_outbox WHERE category = $1`,
      [`schedule:${scheduleId}`],
    );
    expect(rows).toEqual([{ user_id: userId, channel: "push" }]);
    expect(await remindedAt(scheduleId)).not.toBeNull();
  });

  it("retry: re-polling after a successful run never double-sends", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
    const userId = await createUser();
    await optIn(userId, scheduleId, "email");

    await runScheduleRemindersOnce();
    expect(await outboxCount(scheduleId)).toBe(1);

    const again = await runScheduleRemindersOnce();
    expect(again.reminded).toBe(0);
    expect(await outboxCount(scheduleId)).toBe(1);
  });

  it("concurrent: two simultaneous runs never double-send (FOR UPDATE SKIP LOCKED)", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleIds: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
      const userId = await createUser();
      await optIn(userId, scheduleId, "in_app");
      scheduleIds.push(scheduleId);
    }

    const [a, b] = await Promise.all([runScheduleRemindersOnce(), runScheduleRemindersOnce()]);
    expect(a.reminded + b.reminded).toBe(5);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE category LIKE 'schedule:%'`,
    );
    expect(rows[0].n).toBe(5);
    for (const id of scheduleIds) {
      expect(await remindedAt(id)).not.toBeNull();
    }
  });

  it("expired: an item whose start already passed is never reminded", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() - 60 * 60_000));
    const userId = await createUser();
    await optIn(userId, scheduleId, "push");

    const result = await runScheduleRemindersOnce();
    expect(result.reminded).toBe(0);
    expect(await outboxCount(scheduleId)).toBe(0);
    expect(await remindedAt(scheduleId)).toBeNull();
  });

  it("no-recipient: a due item with nobody opted in sends nothing but is still marked reminded", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));

    const result = await runScheduleRemindersOnce();
    expect(result.reminded).toBe(1);
    expect(result.notified).toBe(0);
    expect(await outboxCount(scheduleId)).toBe(0);
    expect(await remindedAt(scheduleId)).not.toBeNull();
  });
});
