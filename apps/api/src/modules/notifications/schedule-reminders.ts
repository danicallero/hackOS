import { config } from "../../config.js";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { readNotificationAutomationSettings } from "./automation-settings.js";
import {
  DEFAULT_CHANNELS,
  type NotifyOptions,
  notifyMany,
  REMINDER_CHANNEL_CATEGORY,
  resolveChannelsMany,
} from "./service.js";

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

/** A device report older than this is ignored, so a stale device falls back to the server push. */
const LOCAL_REMINDER_FRESH_HOURS = 48;

/**
 * Users whose every registered device reported (recently, with this lead)
 * scheduling a local reminder for this item at this start. For them the push
 * channel is skipped; inbox and email still come from the server.
 */
async function usersCoveredByLocalReminders(
  client: Queryable,
  userIds: number[],
  itemId: number,
  startsAtMs: number,
  leadMinutes: number,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const { rows } = await client.query<{ user_id: number }>(
    `SELECT user_id FROM push_tokens
      WHERE user_id = ANY($1::int[])
      GROUP BY user_id
     HAVING bool_and(
              local_reminders_synced_at > now() - make_interval(hours => $2)
              AND local_reminders_lead_minutes = $3
              AND local_reminders @> $4::jsonb)`,
    [
      userIds,
      LOCAL_REMINDER_FRESH_HOURS,
      leadMinutes,
      JSON.stringify([{ id: itemId, startsAtMs }]),
    ],
  );
  return new Set(rows.map((row) => row.user_id));
}

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
    // Event setting (H45, H51): the organizer switch and the lead time.
    const automation = await readNotificationAutomationSettings(client);
    if (!automation.scheduleRemindersEnabled) return { reminded: 0, notified: 0 };
    const { rows } = await client.query(
      `SELECT id, title, location, starts_at, type FROM schedule
        WHERE visibility = 'shown'
          AND reminded_at IS NULL
          AND starts_at > now()
          AND starts_at <= now() + make_interval(mins => $1)
        ORDER BY id
        FOR UPDATE SKIP LOCKED`,
      [automation.scheduleReminderLeadMinutes],
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
           SELECT np.user_id
             FROM item_pref np
             JOIN users u ON u.id = np.user_id
            WHERE np.item_enabled = true
              AND u.account_state = 'active' AND u.anonymized_at IS NULL
           UNION
           SELECT p.user_id
             FROM notification_preferences p
             JOIN users u ON u.id = p.user_id
            WHERE $2::text IS NOT NULL AND p.category = $2 AND p.enabled = true
              AND p.user_id NOT IN (SELECT user_id FROM item_pref)
              AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
          [category, kindCategory],
        );

        const covered = await usersCoveredByLocalReminders(
          client,
          (audienceRows as { user_id: number }[]).map((audience) => audience.user_id),
          row.id,
          row.starts_at.getTime(),
          automation.scheduleReminderLeadMinutes,
        );
        const startsAtLabel = formatStartsAt(row.starts_at, timezone);
        const locationLine = row.location ? `\n\nLocation: ${row.location}` : "";
        const locationSuffix = row.location ? ` · ${row.location}` : "";
        const audienceIds = (audienceRows as { user_id: number }[]).map((a) => a.user_id);
        const resolvedByUser = await resolveChannelsMany(
          client,
          audienceIds.map((userId) => ({
            userId,
            category: REMINDER_CHANNEL_CATEGORY,
            candidates: DEFAULT_CHANNELS,
          })),
        );
        const reminders: NotifyOptions[] = [];
        audienceIds.forEach((userId, idx) => {
          const resolved = resolvedByUser[idx] ?? [];
          // The phone fires this reminder itself, also offline (H51).
          const channels = covered.has(userId)
            ? resolved.filter((channel) => channel !== "push")
            : resolved;
          if (channels.length === 0) return;
          reminders.push({
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
        });
        await notifyMany(client, reminders);
        notified += reminders.length;

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
