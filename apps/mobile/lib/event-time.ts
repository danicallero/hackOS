// H45/H47: every time the app shows or accepts is the EVENT's wall clock (the
// event_config timezone, delivered on GET /api/me as `eventTimezone`), never
// the phone's. MeProvider publishes the zone here; formatters and the native
// date/time pickers read it. Until it is known the device zone stands in.

import {
  deviceTimeZone,
  formatInZone,
  instantToWallClock,
  wallClockToInstant,
  zoneAbbreviation,
} from "@hackos/shared/event-time";
import { createEventTimeZoneStore } from "@hackos/shared/event-time-store";
import { useSyncExternalStore } from "react";

const { setEventTimeZone, getEventTimeZone, subscribe } = createEventTimeZoneStore();

export { getEventTimeZone, setEventTimeZone };

/** Re-renders the caller when the event zone changes. */
export function useEventTimeZone(): string {
  return useSyncExternalStore(subscribe, getEventTimeZone, getEventTimeZone);
}

/** Terse zone name ("CEST") only when the event zone differs from the phone's; "" otherwise. */
export function eventZoneHint(
  locale: string | undefined,
  timeZone: string = getEventTimeZone(),
  at: number = Date.now(),
): string {
  return timeZone === deviceTimeZone() ? "" : zoneAbbreviation(timeZone, locale, at);
}

/**
 * Native pickers work in the phone's zone. To show the event's clock, hand
 * them a Date whose DEVICE-local fields equal the event's wall clock for the
 * instant; `fromPickerDate` is the exact inverse. Round-trips for every
 * instant except one whose event wall time falls inside the phone's own DST
 * gap, which the platform cannot represent.
 */
export function toPickerDate(instant: Date, timeZone: string = getEventTimeZone()): Date {
  const wall = instantToWallClock(instant.toISOString(), timeZone, true);
  if (!wall) return instant;
  const [y, mo, d] = wall.slice(0, 10).split("-").map(Number);
  const [h, mi, s] = wall.slice(11).split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

export function fromPickerDate(picked: Date, timeZone: string = getEventTimeZone()): Date {
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}T${pad(
    picked.getHours(),
  )}:${pad(picked.getMinutes())}:${pad(picked.getSeconds())}`;
  const iso = wallClockToInstant(wall, timeZone);
  return iso ? new Date(iso) : picked;
}

/** `Date.prototype.toLocale*String` replacement that reads the event's clock. */
export function formatEventTime(
  value: string | number | Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
  timeZone: string = getEventTimeZone(),
): string {
  return formatInZone(value, timeZone, locale, options);
}

/** Event-zone calendar day (`yyyy-MM-dd`) of an instant. */
export function eventDayKey(
  value: string | number | Date,
  timeZone: string = getEventTimeZone(),
): string {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "";
  return instantToWallClock(new Date(ms).toISOString(), timeZone).slice(0, 10);
}
