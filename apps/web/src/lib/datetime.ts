import {
  formatInZone,
  instantToWallClock,
  wallClockToInstant,
  zoneOffsetMinutes,
} from "@hackos/shared/event-time";
import { getEventTimeZone } from "./event-time";

// Every formatter and input helper here works in the EVENT's time zone
// (H45/H47), not the browser's: see `./event-time`.

const SHORT_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Shared "en-GB" short display format (e.g. "05 Jan 2026, 14:30") used across
 * admin tables (audit log, invite links) so every surface renders timestamps
 * identically, in the event zone. */
export const shortDateTimeFmt = {
  format: (date: Date) => formatInZone(date, getEventTimeZone(), "en-GB", SHORT_DATE_TIME),
};

export const shortDateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

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

const dateTimeLocalPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const displayDateTimePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
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

export function formatScheduledDateTime(value: string, locale?: string): string {
  const localMatch = dateTimeLocalPattern.exec(value);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return `${day}/${month}/${year} ${hour}:${minute}`;
  }

  return (
    formatInZone(value, getEventTimeZone(), locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) || value
  );
}

export function parseScheduledDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const localMatch = dateTimeLocalPattern.exec(trimmed);
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4]}:${localMatch[5]}`;
  }

  const match = displayDateTimePattern.exec(trimmed);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  // Pure calendar check: UTC fields, so a wall time inside a DST gap is not rejected.
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return `${year}-${padDatePart(month)}-${padDatePart(day)}T${padDatePart(hour)}:${padDatePart(minute)}`;
}
