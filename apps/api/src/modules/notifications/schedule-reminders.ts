import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { type NotificationChannel, notify } from "./service.js";

/**
 * Activity reminder job (H51: "apuntarme a recordatorios de actividades
 * concretas del horario"; issue #80). schedule:<id> is opt-IN, unlike
 * notify()'s default-enabled fallback for ordinary categories (see
 * resolveChannels in service.ts) — so recipients and their exact channel set
 * come straight from notification_preferences rows with enabled=true, not
 * from notify()'s DEFAULT_CHANNELS. Shape mirrors announcements-publisher.ts
 * + fanOutAnnouncement: FOR UPDATE SKIP LOCKED claim, per-recipient notify(),
 * then a bookkeeping timestamp (reminded_at) so a later poll never repeats it.
 */

const QUEUE_NAME = "schedule-reminders";
const LEAD_MINUTES = 15;

interface DueScheduleRow {
  id: number;
  title: string;
  location: string | null;
  starts_at: Date;
}

export async function runScheduleRemindersOnce(): Promise<{ reminded: number; notified: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, title, location, starts_at FROM schedule
        WHERE visibility = 'shown'
          AND reminded_at IS NULL
          AND starts_at > now()
          AND starts_at <= now() + make_interval(mins => $1)
        ORDER BY id
        FOR UPDATE SKIP LOCKED`,
      [LEAD_MINUTES],
    );

    let notified = 0;
    // No JS-side window re-check: the claim query above already gated on the
    // DB clock (see announcements-publisher.ts for the same reasoning).
    for (const row of rows as DueScheduleRow[]) {
      const category = `schedule:${row.id}`;
      const { rows: prefRows } = await client.query(
        `SELECT user_id, channel FROM notification_preferences
          WHERE category = $1 AND enabled = true`,
        [category],
      );
      const channelsByUser = new Map<number, NotificationChannel[]>();
      for (const pref of prefRows as { user_id: number; channel: NotificationChannel }[]) {
        const list = channelsByUser.get(pref.user_id) ?? [];
        list.push(pref.channel);
        channelsByUser.set(pref.user_id, list);
      }

      const locationLine = row.location ? `\n\nLocation: ${row.location}` : "";
      for (const [userId, channels] of channelsByUser) {
        await notify(client, {
          userId,
          category,
          channels,
          payload: {
            template: "schedule.reminder",
            vars: {
              title: row.title,
              locationLine,
              startsAt: row.starts_at.toISOString(),
            },
          },
        });
        notified += 1;
      }

      await client.query(`UPDATE schedule SET reminded_at = now() WHERE id = $1`, [row.id]);
    }
    return { reminded: rows.length, notified };
  });
}

registerWorker(QUEUE_NAME, async () => {
  await runScheduleRemindersOnce();
});

export async function scheduleActivityReminders(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
