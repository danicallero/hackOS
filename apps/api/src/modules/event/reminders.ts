import { config } from "../../config.js";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";

const QUEUE_NAME = "event-email-reminders";
export interface EventReminder {
  id: number;
  scheduled_at: Date;
  status: "scheduled" | "queued" | "cancelled" | "expired";
  queued_at: Date | null;
  recipient_count: number;
}
export async function readEventReminder(db: Queryable): Promise<EventReminder | null> {
  const { rows } = await db.query<EventReminder>(
    "SELECT id, scheduled_at, status, queued_at, recipient_count FROM event_email_reminders ORDER BY id DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

/** H45/H52: part of the same transaction and Save action as event settings. */
export async function saveEventReminder(
  client: Queryable,
  actorId: number | null,
  scheduledAt: Date | null,
): Promise<void> {
  const { rows } = await client.query(
    "SELECT id, scheduled_at FROM event_email_reminders WHERE status = 'scheduled' FOR UPDATE",
  );
  const before = rows[0] ?? null;
  if (scheduledAt) {
    const event = await client.query(
      "SELECT name, event_starts_at, now() AS clock FROM event_config WHERE id = 1",
    );
    const saved = event.rows[0];
    if (!saved?.name?.trim() || !saved.event_starts_at)
      throw new BadRequestError(
        "Save the event name and opening time before scheduling a reminder",
      );
    if (scheduledAt <= saved.clock || scheduledAt >= saved.event_starts_at)
      throw new BadRequestError("Schedule the reminder in the future, before the event opens");
  }
  if (before && scheduledAt?.getTime() === before.scheduled_at.getTime()) return;
  if (!before && !scheduledAt) return;
  if (before)
    await client.query("UPDATE event_email_reminders SET status = 'cancelled' WHERE id = $1", [
      before.id,
    ]);
  let after = null;
  if (scheduledAt) {
    const inserted = await client.query(
      "INSERT INTO event_email_reminders (scheduled_at, created_by) VALUES ($1, $2) RETURNING id, scheduled_at",
      [scheduledAt, actorId],
    );
    after = inserted.rows[0];
  }
  await audit(client, {
    actorId,
    entityType: "event_email_reminder",
    entityId: after?.id ?? before?.id,
    action: after ? "scheduled" : "cancelled",
    before,
    after,
  });
}

/** H52: claim and fan out atomically; concurrent ticks cannot enqueue twice. */
export async function runEventRemindersOnce(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM event_email_reminders WHERE status = 'scheduled' AND scheduled_at <= now() FOR UPDATE SKIP LOCKED",
    );
    let recipients = 0;
    for (const reminder of rows) {
      const event = await client.query(
        "SELECT name, event_starts_at > now() AS upcoming FROM event_config WHERE id = 1",
      );
      if (!event.rows[0]?.name?.trim() || !event.rows[0]?.upcoming) {
        await client.query("UPDATE event_email_reminders SET status = 'expired' WHERE id = $1", [
          reminder.id,
        ]);
        await audit(client, {
          actorId: null,
          entityType: "event_email_reminder",
          entityId: reminder.id,
          action: "expired",
          source: "system",
        });
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO notification_outbox (user_id, category, channel, payload)
        SELECT u.id, 'event.reminder', 'email', jsonb_build_object('template', 'event.reminder', 'vars', jsonb_build_object('reminderId', $1::integer))
          FROM users u WHERE u.account_state = 'active' AND u.anonymized_at IS NULL AND NOT u.is_test_account
          AND EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id = u.id)
          FOR SHARE OF u`,
        [reminder.id],
      );
      const count = inserted.rowCount ?? 0;
      await client.query(
        "UPDATE event_email_reminders SET status = 'queued', queued_at = now(), recipient_count = $2 WHERE id = $1",
        [reminder.id, count],
      );
      await audit(client, {
        actorId: null,
        entityType: "event_email_reminder",
        entityId: reminder.id,
        action: "queued",
        source: "system",
        after: { recipientCount: count },
      });
      recipients += count;
    }
    return recipients;
  });
}
registerWorker(QUEUE_NAME, async () => {
  await runEventRemindersOnce();
});
export async function scheduleEventReminders(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
