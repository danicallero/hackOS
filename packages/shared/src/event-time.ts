/**
 * Event-timezone helpers (H45, H47, H48, H59). Every datetime a person reads
 * or types in web or mobile is the EVENT's wall clock (the `event_config`
 * timezone), never the device's. Pure `Intl`, no dependency; DST-safe.
 *
 * "Wall clock" strings are `yyyy-MM-ddTHH:mm[:ss]` with no offset, the shape
 * `<input type="datetime-local">` uses.
 */

const WALL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The device's own zone; the fallback while the event zone is unknown. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Wall-clock fields of an instant as seen in `timeZone`. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour === 24 ? 0 : (out.hour ?? 0),
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** Offset of `timeZone` from UTC at an instant, in minutes (Madrid summer = 120). */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Instant (ISO) -> `yyyy-MM-ddTHH:mm` (or with `:ss`) wall clock in `timeZone`; "" when invalid. */
export function instantToWallClock(
  iso: string | null | undefined,
  timeZone: string,
  includeSeconds = false,
): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const p = zonedParts(ms, timeZone);
  const base = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  return includeSeconds ? `${base}:${pad(p.second)}` : base;
}

/**
 * Wall clock in `timeZone` -> UTC instant (ISO), or null when unparsable.
 * A wall time that occurs twice (clocks go back) resolves to the first
 * occurrence; one that never occurs (clocks go forward) resolves with the
 * offset in force before the change, i.e. it moves forward by the gap
 * (02:30 -> 03:30).
 */
export function wallClockToInstant(value: string, timeZone: string): string | null {
  const m = WALL_PATTERN.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] ?? 0);
  const minute = Number(m[5] ?? 0);
  const second = Number(m[6] ?? 0);
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(naive)) return null;
  const check = new Date(naive);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const DAY = 86_400_000;
  const before = zoneOffsetMinutes(naive - DAY, timeZone);
  const after = zoneOffsetMinutes(naive + DAY, timeZone);
  const candidates: number[] = [];
  for (const offset of new Set([before, after])) {
    const candidate = naive - offset * 60_000;
    if (zoneOffsetMinutes(candidate, timeZone) === offset) candidates.push(candidate);
  }
  const picked = candidates.length > 0 ? Math.min(...candidates) : naive - before * 60_000;
  return new Date(picked).toISOString();
}

/** Wall-clock "today" (yyyy-MM-dd) in `timeZone`. */
export function todayInZone(timeZone: string, nowMs: number = Date.now()): string {
  return instantToWallClock(new Date(nowMs).toISOString(), timeZone).slice(0, 10);
}

/** Formats an instant in `timeZone`; "" when the value is not a date. */
export function formatInZone(
  value: string | number | Date | null | undefined,
  timeZone: string,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}

/** Terse zone name for an instant ("CEST", "GMT+2"); "" when unavailable. */
export function zoneAbbreviation(
  timeZone: string,
  locale: string | undefined,
  at: number = Date.now(),
): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}
