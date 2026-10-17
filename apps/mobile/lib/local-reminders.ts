import type { Language } from "@hackos/shared/locale";
import * as Notifications from "expo-notifications";
import { apiFetch } from "./api";
import { formatEventTime } from "./event-time";
import type { NotificationPreferences } from "./notification-preferences";
import { getRegisteredPushToken, registerForPushNotifications } from "./push";
import { fetchPublicSchedule, resolveScheduleText, type ScheduleItem } from "./schedule";
import { isEntrySubscribedFrom } from "./schedule-subscriptions";

/**
 * H51/H59: activity reminders the phone schedules itself, so they fire on
 * time without a connection and the server does not fan out a push per
 * person. The server keeps sending the push to any device that has not
 * reported covering the item (`PUT /api/me/local-reminders`).
 */

export const LOCAL_REMINDER_PREFIX = "local-reminder:";
/** iOS keeps only the 64 soonest pending local notifications; leave room for other uses. */
export const MAX_LOCAL_REMINDERS = 50;
/** A trigger this close to now would race the clock; the server push covers it instead. */
const MIN_LEAD_TIME_MS = 5_000;

export interface ReminderSettings {
  enabled: boolean;
  leadMinutes: number;
}

export interface PlannedReminder {
  id: number;
  startsAtMs: number;
  fireAtMs: number;
  identifier: string;
  title: string;
  body: string;
}

/** Which upcoming, subscribed items get a local reminder, soonest first. */
export function planLocalReminders({
  items,
  prefs,
  settings,
  nowMs,
  language,
  bodyFor,
}: {
  items: ScheduleItem[];
  prefs: NotificationPreferences;
  settings: ReminderSettings;
  nowMs: number;
  language: Language;
  bodyFor: (item: ScheduleItem, startsAtMs: number) => string;
}): PlannedReminder[] {
  if (!settings.enabled) return [];
  const planned: PlannedReminder[] = [];
  for (const item of items) {
    // Staff also receive drafts in this feed; nobody is reminded of an unpublished item.
    if (item.visibility === "hidden" || !isEntrySubscribedFrom(prefs, item)) continue;
    const startsAtMs = Date.parse(item.startsAt);
    if (!Number.isFinite(startsAtMs)) continue;
    const fireAtMs = startsAtMs - settings.leadMinutes * 60_000;
    if (fireAtMs <= nowMs + MIN_LEAD_TIME_MS) continue;
    planned.push({
      id: item.id,
      startsAtMs,
      fireAtMs,
      identifier: `${LOCAL_REMINDER_PREFIX}${item.id}`,
      title: resolveScheduleText(item, language).title,
      body: bodyFor(item, startsAtMs),
    });
  }
  return planned.sort((a, b) => a.fireAtMs - b.fireAtMs).slice(0, MAX_LOCAL_REMINDERS);
}

/** Starts-at line shared by every language: the time in the event's zone plus the place. */
export function reminderBody(
  item: Pick<ScheduleItem, "location">,
  startsAtMs: number,
  language: Language,
  t: (key: "localReminderBody", vars: Record<string, string>) => string,
): string {
  const time = formatEventTime(startsAtMs, language, { hour: "2-digit", minute: "2-digit" });
  return t("localReminderBody", { time: item.location ? `${time} · ${item.location}` : time });
}

async function cancelAllLocalReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.identifier.startsWith(LOCAL_REMINDER_PREFIX))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

/** Sign-out and account switches must not leave the previous account's reminders on the device. */
export function clearLocalReminders(): Promise<void> {
  return cancelAllLocalReminders().catch(() => undefined);
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Reconciles the device's local reminders with the schedule, the person's
 * opt-ins and the event settings, then reports what it covers. Reads that
 * fail (offline) leave the existing reminders untouched: they keep firing.
 */
export function syncLocalReminders(options: {
  userId: number;
  language: Language;
  t: (key: "localReminderBody", vars: Record<string, string>) => string;
}): Promise<void> {
  const run = queue.then(() => reconcile(options)).catch(() => undefined);
  queue = run;
  return run;
}

async function reconcile({
  userId,
  language,
  t,
}: Parameters<typeof syncLocalReminders>[0]): Promise<void> {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    await cancelAllLocalReminders();
    return;
  }
  const [items, prefs, settings] = await Promise.all([
    fetchPublicSchedule(),
    apiFetch<NotificationPreferences>("/api/me/notification-preferences"),
    apiFetch<ReminderSettings>("/api/me/reminder-settings"),
  ]);
  const plan = planLocalReminders({
    items,
    prefs,
    settings,
    nowMs: Date.now(),
    language,
    bodyFor: (item, startsAtMs) => reminderBody(item, startsAtMs, language, t),
  });

  await cancelAllLocalReminders();
  const scheduled: PlannedReminder[] = [];
  for (const reminder of plan) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.identifier,
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { category: `schedule:${reminder.id}`, localReminder: true },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(reminder.fireAtMs),
          channelId: "default",
        },
      });
      scheduled.push(reminder);
    } catch {
      // An item that could not be scheduled is simply not reported: the server push covers it.
    }
  }

  // The report needs this device's registered token; without one the server pushes as before.
  await registerForPushNotifications(userId).catch(() => undefined);
  const token = getRegisteredPushToken(userId);
  if (!token) return;
  await apiFetch("/api/me/local-reminders", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      leadMinutes: settings.leadMinutes,
      items: scheduled.map(({ id, startsAtMs }) => ({ id, startsAtMs })),
    }),
  });
}
