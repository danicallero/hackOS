import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { DEFAULT_CHANNELS, notify, REMINDER_CHANNEL_CATEGORY, resolveChannels } from "./service.js";

/**
 * Activity reminder job (H51: "apuntarme a recordatorios de actividades
 * concretas del horario, o de todas las de un tipo"; issue #80). Opting in —
 * individually (`schedule:<id>`) or by kind (`schedule:type:<kind>`, e.g.
 * "all meals") — is a plain membership marker (any enabled=true row), unlike
 * notify()'s default-enabled fallback for ordinary categories. What channels
 * actually fire is a separate, shared decision: the `schedule` category,
 * resolved the same default-enabled-unless-overridden way as any other
 * category (see resolveChannels in service.ts) — one config for every
 * reminder a user gets, not one per activity. Shape mirrors
 * announcements-publisher.ts + fanOutAnnouncement: FOR UPDATE SKIP LOCKED
 * claim, per-recipient notify(), then a bookkeeping timestamp (reminded_at)
 * so a later poll never repeats it.
 */

const QUEUE_NAME = "schedule-reminders";
const LEAD_MINUTES = 15;

interface DueScheduleRow {
  id: number;
  title: string;
  location: string | null;
  starts_at: Date;
  type: string | null;
}

/**
 * Renders a compact, human time for reminder copy ("Sat, 08:20") instead of
 * the raw ISO instant — the latter reads fine in an API response but is
 * useless in a push notification header (see issue: notif showed
 * "starts at 2026-07-18T06:20:00.000Z" verbatim). Formatted in the event's
 * configured timezone, with a fixed en-GB/24h locale: reminders fan out to
 * many recipients across languages in one pass (vars are shared, not
 * per-recipient), so this stays legible regardless of the reader's language
 * rather than picking one user's locale for everyone.
 */
function formatStartsAt(startsAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(startsAt);
}

export async function runScheduleRemindersOnce(): Promise<{ reminded: number; notified: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, title, location, starts_at, type FROM schedule
        WHERE visibility = 'shown'
          AND reminded_at IS NULL
          AND starts_at > now()
          AND starts_at <= now() + make_interval(mins => $1)
        ORDER BY id
        FOR UPDATE SKIP LOCKED`,
      [LEAD_MINUTES],
    );

    let notified = 0;
    if (rows.length > 0) {
      const { rows: eventRows } = await client.query(
        `SELECT timezone FROM event_config WHERE id = 1`,
      );
      const timezone: string = eventRows[0]?.timezone || "UTC";

      // No JS-side window re-check: the claim query above already gated on the
      // DB clock (see announcements-publisher.ts for the same reasoning).
      for (const row of rows as DueScheduleRow[]) {
        const category = `schedule:${row.id}`;
        const kindCategory = row.type ? `schedule:type:${row.type}` : null;
        // An item-level row, when present, always wins over the kind-level
        // one instead of the two being OR'd — otherwise muting a single
        // entry inside an otherwise-subscribed kind (H59 mobile bell UX)
        // couldn't actually suppress that entry's reminder.
        const { rows: audienceRows } = await client.query(
          `WITH item_pref AS (
             SELECT user_id, bool_or(enabled) AS item_enabled
             FROM notification_preferences
             WHERE category = $1
             GROUP BY user_id
           )
           SELECT user_id FROM item_pref WHERE item_enabled = true
           UNION
           SELECT user_id FROM notification_preferences
           WHERE $2::text IS NOT NULL AND category = $2 AND enabled = true
             AND user_id NOT IN (SELECT user_id FROM item_pref)`,
          [category, kindCategory],
        );

        const startsAtLabel = formatStartsAt(row.starts_at, timezone);
        const locationLine = row.location ? `\n\nLocation: ${row.location}` : "";
        const locationSuffix = row.location ? ` · ${row.location}` : "";
        for (const { user_id: userId } of audienceRows as { user_id: number }[]) {
          const channels = await resolveChannels(
            client,
            userId,
            REMINDER_CHANNEL_CATEGORY,
            DEFAULT_CHANNELS,
          );
          if (channels.length === 0) continue;
          await notify(client, {
            userId,
            category,
            channels,
            payload: {
              template: "schedule.reminder",
              vars: {
                title: row.title,
                locationLine,
                locationSuffix,
                startsAtLabel,
              },
            },
          });
          notified += 1;
        }

        await client.query(`UPDATE schedule SET reminded_at = now() WHERE id = $1`, [row.id]);
      }
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
