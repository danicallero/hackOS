import { formatInZone } from "@hackos/shared/event-time";
import { getEventTimeZone } from "./event-time";
import type { Lang } from "./i18n";

/** Whole calendar days between two `yyyy-MM-dd` keys. */
function daysBetween(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Formats a "last successful update" timestamp the way a person reads it:
 * just the time for today, "Yesterday, <time>" for yesterday, a weekday name
 * for the rest of the current week, and a short date beyond that. Days and
 * clock readings are the event's (H45/H47), the same clock the schedule shows.
 */
export function formatLastUpdate(
  iso: string,
  language: Lang,
  t: (key: "yesterday") => string,
  now: Date = new Date(),
  timeZone: string = getEventTimeZone(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = formatInZone(date, timeZone, language, { hour: "numeric", minute: "2-digit" });
  const dayKey = (value: Date) =>
    formatInZone(value, timeZone, "en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  const age = daysBetween(dayKey(date), dayKey(now));

  if (age <= 0) return time;
  if (age === 1) return `${t("yesterday")}, ${time}`;
  if (age < 7) {
    const weekday = formatInZone(date, timeZone, language, { weekday: "long" });
    return `${weekday}, ${time}`;
  }
  const shortDate = formatInZone(date, timeZone, language, { dateStyle: "short" });
  return `${shortDate}, ${time}`;
}
