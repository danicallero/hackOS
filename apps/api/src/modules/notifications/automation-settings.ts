import {
  type NotificationAutomationSettings,
  SCHEDULE_REMINDER_LEAD_MINUTES_DEFAULT,
} from "@hackos/shared/notification-automation";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getQueue } from "../../lib/queues.js";

/**
 * Organizer switch and timing of the automatic notification jobs (H45, H51,
 * H52). Only an intentional lead override is stored (R018): NULL means the
 * built-in default. A missing row reads as enabled with the default, so a
 * cleaned table never silences reminders.
 */

export const SCHEDULE_REMINDERS_QUEUE = "schedule-reminders";

export async function readNotificationAutomationSettings(
  db: Queryable = pool,
): Promise<NotificationAutomationSettings> {
  const { rows } = await db.query<{
    schedule_reminders_enabled: boolean;
    schedule_reminder_lead_minutes: number | null;
  }>(
    `SELECT schedule_reminders_enabled, schedule_reminder_lead_minutes
       FROM notification_automation_settings WHERE id = 1`,
  );
  const lead = rows[0]?.schedule_reminder_lead_minutes ?? null;
  return {
    scheduleRemindersEnabled: rows[0]?.schedule_reminders_enabled ?? true,
    scheduleReminderLeadMinutes: lead ?? SCHEDULE_REMINDER_LEAD_MINUTES_DEFAULT,
    defaultScheduleReminderLeadMinutes: SCHEDULE_REMINDER_LEAD_MINUTES_DEFAULT,
    scheduleReminderLeadCustom: lead !== null,
  };
}

export interface NotificationAutomationInput {
  scheduleRemindersEnabled?: boolean;
  /** `undefined` keeps it; `null` (or the default itself) clears the override. */
  scheduleReminderLeadMinutes?: number | null;
}

/** Saves the switch and lead in one audited transaction (H53). */
export async function saveNotificationAutomationSettings(
  actorId: number,
  input: NotificationAutomationInput,
): Promise<NotificationAutomationSettings> {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO notification_automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(`SELECT id FROM notification_automation_settings WHERE id = 1 FOR UPDATE`);
    const before = await readNotificationAutomationSettings(client);
    if (input.scheduleRemindersEnabled !== undefined) {
      await client.query(
        `UPDATE notification_automation_settings SET schedule_reminders_enabled = $1 WHERE id = 1`,
        [input.scheduleRemindersEnabled],
      );
    }
    if (input.scheduleReminderLeadMinutes !== undefined) {
      const override =
        input.scheduleReminderLeadMinutes === SCHEDULE_REMINDER_LEAD_MINUTES_DEFAULT
          ? null
          : input.scheduleReminderLeadMinutes;
      await client.query(
        `UPDATE notification_automation_settings SET schedule_reminder_lead_minutes = $1 WHERE id = 1`,
        [override],
      );
    }
    const after = await readNotificationAutomationSettings(client);
    await audit(client, {
      actorId,
      entityType: "notification_automation_settings",
      entityId: 1,
      action: "update",
      before,
      after,
    });
    return after;
  });
}

const KICK_DEBOUNCE_MS = 2_000;

/**
 * Best effort early run of the schedule-reminder job after a save, so a new
 * lead or switch applies without waiting for the next 15 s tick.
 */
export async function requestScheduleRemindersRun(): Promise<void> {
  try {
    await getQueue(SCHEDULE_REMINDERS_QUEUE).add(
      "kick",
      {},
      {
        delay: KICK_DEBOUNCE_MS,
        deduplication: { id: `${SCHEDULE_REMINDERS_QUEUE}-kick`, ttl: KICK_DEBOUNCE_MS },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch {
    // The repeatable tick converges anyway.
  }
}
