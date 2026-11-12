import {
  formatInZone,
  instantToWallClock,
  wallClockToInstant,
  zoneOffsetMinutes,
} from "@hackos/shared/event-time";
import { getEventTimeZone } from "./event-time";
import type { Translate } from "./i18n";
import { LOCALE_CODES } from "./locale";
import type { Language } from "./types";

// Every formatter and input helper here works in the EVENT's time zone
// (H45/H47), not the browser's: see `./event-time`.

/** ISO instant -> `yyyy-MM-ddTHH:mm` wall clock in the event zone (input value). */
export function toDatetimeLocal(
  iso: string | null,
  includeSeconds = false,
  timeZone: string = getEventTimeZone(),
): string {
  return instantToWallClock(iso, timeZone, includeSeconds);
}

/** Wall clock typed in the event zone -> ISO instant, null when blank/invalid. */
export function fromDatetimeLocal(
  value: string,
  timeZone: string = getEventTimeZone(),
): string | null {
  if (!value) return null;
  return wallClockToInstant(value, timeZone);
}

/**
 * Event IANA zone id plus its UTC offset (e.g. "Europe/Madrid (UTC+2)"), so
 * publication-time fields never leave the reader guessing which clock a
 * scheduled reveal uses (H45, H48).
 */
export function getTimeZoneLabel(): string {
  const zone = getEventTimeZone();
  const offsetMinutes = zoneOffsetMinutes(Date.now(), zone);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const offset = minutes === 0 ? `${hours}` : `${hours}:${String(minutes).padStart(2, "0")}`;
  return `${zone} (UTC${sign}${offset})`;
}

/** Clock reading ("14:30") of an instant in the event zone (H45/H47). */
export function formatEventClock(value: string | number | Date, locale?: string): string {
  return formatInZone(value, getEventTimeZone(), locale, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Named display formats. Every presentation of a timestamp goes through
 * `formatEventDate`/`eventDateFormat` so it renders in the event zone and the
 * app language, never the browser's (H45/H47).
 */
const DATE_PRESETS = {
  /** "5 Jan 2026" */
  date: { day: "numeric", month: "short", year: "numeric" },
  /** "05 Jan 2026, 14:30": the one format for any stored timestamp. Explicit
   * fields, not dateStyle/timeStyle, so browsers cannot swap "," for "at". */
  dateTime: {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  /** "05 Jan, 14:30" */
  dayMonthTime: { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
  /** "5 Jan" */
  dayMonth: { day: "numeric", month: "short" },
  /** "5 Jan, 14" (hourly chart buckets). */
  dayMonthHour: { day: "numeric", month: "short", hour: "2-digit" },
  /** "Sat, 12 Oct" */
  weekdayDayMonthText: { weekday: "short", day: "numeric", month: "short" },
  /** "Saturday, 12 October" */
  weekdayDayMonthLong: { weekday: "long", day: "numeric", month: "long" },
  /** "Sat, 14:30" */
  weekdayClock: { weekday: "short", hour: "2-digit", minute: "2-digit" },
  /** "Mon" */
  weekday: { weekday: "short" },
  /** "Mon 05/01" */
  weekdayDayMonth: { weekday: "short", day: "2-digit", month: "2-digit" },
  /** "14:30" */
  clock: { hour: "2-digit", minute: "2-digit" },
  /** "14:30", always 24-hour. */
  clock24: { hour: "2-digit", minute: "2-digit", hour12: false },
  /** "05/01/2026, 14:30" in 24-hour time (exports). */
  numericDateTime24: {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

type DatePreset = keyof typeof DATE_PRESETS;

/** An `Intl.DateTimeFormat` for `preset` in the event zone (or `timeZone`) and the app language. */
export function eventDateFormat(
  language: Language,
  preset: DatePreset,
  timeZone: string = getEventTimeZone(),
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE_CODES[language], { ...DATE_PRESETS[preset], timeZone });
}

/** Formats an instant with `preset`; "" when the value is missing or not a date. */
export function formatEventDate(
  value: string | number | Date | null | undefined,
  language: Language,
  preset: DatePreset,
  timeZone: string = getEventTimeZone(),
): string {
  return formatInZone(value, timeZone, LOCALE_CODES[language], DATE_PRESETS[preset]);
}

/** Whole minutes as "h:mm" ("1:05"); "" for a non-positive or invalid span. */
export function formatHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "";
  const rounded = Math.round(totalMinutes);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

/** Localized "45 min" / "2 h" / "2 h 5 min" for a span of whole minutes. */
export function formatDurationMinutes(minutes: number, t: Translate): string {
  if (minutes < 60) return t("presenceMinutesValue", { minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("presenceWholeHoursValue", { hours })
    : t("presenceHoursMinutesValue", { hours, minutes: remainder });
}

/**
 * `<input type="datetime-local">` carries NO timezone: its value is a bare
 * wall-clock string. Event settings read and write it in the event's zone
 * (H45/H47), by default the saved one; the settings form passes the zone it
 * is currently editing so a changed Timezone field reinterprets the same
 * wall clock rather than the browser's.
 */
export function toLocalInputValue(
  iso: string | null,
  timeZone: string = getEventTimeZone(),
): string {
  return toDatetimeLocal(iso, false, timeZone);
}

export function fromLocalInputValue(
  value: string,
  timeZone: string = getEventTimeZone(),
): string | null {
  return fromDatetimeLocal(value, timeZone);
}
