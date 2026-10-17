import type {
  NotificationPreferences,
  NotificationPreferenceUpdate,
} from "./notification-preferences";
import type { ScheduleItem } from "./schedule";

/** Pure H59 subscription rules shared by the Schedule tab and the device-local reminders. */

export const CHANNEL = "push" as const;

export function itemCategory(id: number): string {
  return `schedule:${id}`;
}

export function kindCategory(kind: string): string {
  return `schedule:type:${kind}`;
}

export function preferenceFor(
  prefs: NotificationPreferences,
  category: string,
): NotificationPreferenceUpdate | undefined {
  return prefs.overrides.find((row) => row.category === category && row.channel === CHANNEL);
}

export function isEntrySubscribedFrom(
  prefs: NotificationPreferences,
  item: Pick<ScheduleItem, "id" | "type">,
): boolean {
  const own = preferenceFor(prefs, itemCategory(item.id));
  if (own) return own.enabled;
  return item.type ? (preferenceFor(prefs, kindCategory(item.type))?.enabled ?? false) : false;
}
