import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createUser } from "../helpers.js";
import { clearMailpit, getMailpitMessage, listMailpitMessages } from "./mailpit-helpers.js";
import { resetNotificationsState } from "./notif-helpers.js";

/**
 * Activity reminder job (H51 "recordatorios de actividades concretas del
 * horario"; issue #80). Covers the due/retry/concurrent/expired/no-recipient
 * matrix the issue's AC calls out, mirroring
 * test/notifications/dispatcher.test.ts's style for the concurrency case.
 */

beforeEach(async () => {
  await resetNotificationsState();
  await clearMailpit();
});

async function waitForMailpit(count: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = await listMailpitMessages();
    if (messages.length >= count) return messages;
    if (Date.now() > deadline) {
      throw new Error(`Mailpit: expected ${count} messages, got ${messages.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function createScheduleItem(startsAt: Date, type: string | null = null): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO schedule (title, starts_at, ends_at, visibility, type)
     VALUES ($1, $2::timestamptz, $2::timestamptz + interval '1 hour', 'shown', $3)
     RETURNING id`,
    [`Activity ${crypto.randomUUID()}`, startsAt, type],
  );
  return rows[0].id;
}

/** Individual opt-in (H51 rework): membership marker, not a channel choice — see service.ts REMINDER_CHANNEL_CATEGORY. */
async function optIn(userId: number, scheduleId: number): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, 'in_app', true)`,
    [userId, `schedule:${scheduleId}`],
  );
}

/** Kind opt-in (H51 rework): "remind me for every activity of this type". */
async function optInKind(userId: number, type: string): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     VALUES ($1, $2, 'in_app', true)`,
    [userId, `schedule:type:${type}`],
  );
}

/** Restricts the shared reminder channel config to exactly `channels` (H51 rework). */
async function setReminderChannels(userId: number, channels: string[]): Promise<void> {
  const allCandidates = ["in_app", "email", "push"];
  for (const channel of allCandidates) {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'schedule', $2, $3)`,
      [userId, channel, channels.includes(channel)],
    );
  }
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
  it("due: opted-in user gets exactly one reminder on the channels the shared reminder config chose", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
    const userId = await createUser();
    await optIn(userId, scheduleId);
    await setReminderChannels(userId, ["push"]);

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

  it("kind: a user opted into a whole activity kind is reminded without an individual opt-in", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000), "meal");
    const userId = await createUser();
    await optInKind(userId, "meal");
    await setReminderChannels(userId, ["push"]);

    const result = await runScheduleRemindersOnce();
    expect(result.notified).toBe(1);

    const { rows } = await pool.query(
      `SELECT user_id, channel FROM notification_outbox WHERE category = $1`,
      [`schedule:${scheduleId}`],
    );
    expect(rows).toEqual([{ user_id: userId, channel: "push" }]);
  });

  it("shared channels: disabling a channel on the shared reminder config suppresses it for both individual and kind opt-ins", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const individualId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
    const kindId = await createScheduleItem(new Date(Date.now() + 10 * 60_000), "meal");
    const userId = await createUser();
    await optIn(userId, individualId);
    await optInKind(userId, "meal");
    await setReminderChannels(userId, ["push"]); // email/in_app explicitly off

    await runScheduleRemindersOnce();

    const { rows } = await pool.query(
      `SELECT category, channel FROM notification_outbox WHERE user_id = $1 ORDER BY category`,
      [userId],
    );
    expect(rows).toEqual([
      { category: `schedule:${individualId}`, channel: "push" },
      { category: `schedule:${kindId}`, channel: "push" },
    ]);
  });

  it("retry: re-polling after a successful run never double-sends", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const scheduleId = await createScheduleItem(new Date(Date.now() + 10 * 60_000));
    const userId = await createUser();
    await optIn(userId, scheduleId);
    await setReminderChannels(userId, ["email"]);

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
      await optIn(userId, scheduleId);
      await setReminderChannels(userId, ["in_app"]);
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
    await optIn(userId, scheduleId);

    const result = await runScheduleRemindersOnce();
    expect(result.reminded).toBe(0);
    expect(await outboxCount(scheduleId)).toBe(0);
    expect(await remindedAt(scheduleId)).toBeNull();
  });

  it("delivers a real email through the dispatcher with a human-readable time, not raw ISO", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );
    const { drainOutboxOnce } = await import("../../src/modules/notifications/dispatcher.js");

    const startsAt = new Date(Date.now() + 10 * 60_000);
    const { rows } = await pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at, visibility, location)
       VALUES ($1, $2::timestamptz, $2::timestamptz + interval '1 hour', 'shown', $3)
       RETURNING id`,
      [`Desayuno ${crypto.randomUUID()}`, startsAt, "Planta 1"],
    );
    const scheduleId = rows[0].id;
    const userId = await createUser({ email: `reminder-${scheduleId}@test.local` });
    await optIn(userId, scheduleId);
    await setReminderChannels(userId, ["email"]);

    const result = await runScheduleRemindersOnce();
    expect(result.notified).toBe(1);

    const drain = await drainOutboxOnce();
    expect(drain.sent).toBe(1);

    const messages = await waitForMailpit(1);
    expect(messages[0]!.To[0]!.Address).toBe(`reminder-${scheduleId}@test.local`);
    const detail = await getMailpitMessage(messages[0]!.ID);
    expect(detail.Text).toContain("Planta 1");
    expect(detail.Text).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no raw ISO instant leaking into the copy
  });

  it("in-app: opting in also lands a rendered, readable row in the inbox", async () => {
    const { runScheduleRemindersOnce } = await import(
      "../../src/modules/notifications/schedule-reminders.js"
    );

    const startsAt = new Date(Date.now() + 10 * 60_000);
    const { rows } = await pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at, visibility, location)
       VALUES ($1, $2::timestamptz, $2::timestamptz + interval '1 hour', 'shown', $3)
       RETURNING id`,
      ["Desayuno Sábado", startsAt, "Planta 1"],
    );
    const scheduleId = rows[0].id;
    const userId = await createUser();
    await optIn(userId, scheduleId);
    await setReminderChannels(userId, ["in_app"]);

    const result = await runScheduleRemindersOnce();
    expect(result.notified).toBe(1);

    const { rows: outboxRows } = await pool.query(
      `SELECT channel, payload FROM notification_outbox WHERE category = $1`,
      [`schedule:${scheduleId}`],
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].channel).toBe("in_app");
    const payload = outboxRows[0].payload as { subject: string; body: string };
    expect(payload.subject).toBe("Reminder: Desayuno Sábado");
    expect(payload.body).toContain("Planta 1");
    expect(payload.body).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // human time, not the raw ISO instant
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
