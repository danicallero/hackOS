import type { Lang } from "./i18n";

/** Days back from today, ignoring the time of day. */
function daysAgo(from: Date, to: Date): number {
  const fromDay = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toDay - fromDay) / 86_400_000);
}

/**
 * Formats a "last successful update" timestamp the way a person reads it:
 * just the time for today, "Yesterday, <time>" for yesterday, a weekday name
 * for the rest of the current week, and a short date beyond that.
 */
export function formatLastUpdate(
  iso: string,
  language: Lang,
  t: (key: "yesterday") => string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const time = date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
  const age = daysAgo(date, now);

  if (age <= 0) return time;
  if (age === 1) return `${t("yesterday")}, ${time}`;
  if (age < 7) {
    const weekday = date.toLocaleDateString(language, { weekday: "long" });
    return `${weekday}, ${time}`;
  }
  const shortDate = date.toLocaleDateString(language, { dateStyle: "short" });
  return `${shortDate}, ${time}`;
}
