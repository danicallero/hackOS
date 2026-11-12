import { wallClockToInstant } from "@hackos/shared/event-time";
import type { AvailabilityInterval, HelperCard } from "@hackos/shared/help-desk";
import { apiFetch } from "./api";
import { eventDayKey, formatEventTime, getEventTimeZone } from "./event-time";
import { canUseHelpDesk } from "./tabs";

export type {
  AvailabilityInterval,
  CoverageReport,
  HelperCard,
  HelperDetail,
  HelpRequest,
  HelpTopic,
  MeetingMode,
  MyHelperProfile,
} from "@hackos/shared/help-desk";

/** A challenge a request or sponsor can be tied to (H65 extension). */
export interface HelpChallenge {
  id: number;
  name: string;
}
export { coverageDays, validAvailability, validHelpRequest } from "@hackos/shared/help-desk";

export const canBrowseHelpDesk = canUseHelpDesk;
export function helpMutation<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  // A JSON content type with no body is a malformed request: cancel, release and resolve send none.
  return apiFetch<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export interface HelperFilter {
  query: string;
  kinds: HelperCard["kind"][];
  roles?: string[];
  topicIds: number[];
}

/** H63: roles and knowledge are multi-select (any of each group); search matches name or topic. */
export function filterHelpers(helpers: HelperCard[], filter: HelperFilter): HelperCard[] {
  const needle = filter.query.trim().toLocaleLowerCase();
  return helpers.filter(
    (helper) =>
      (filter.kinds.length === 0 || filter.kinds.includes(helper.kind)) &&
      (!filter.roles?.length ||
        (helper.visibleRoleName !== null && filter.roles.includes(helper.visibleRoleName))) &&
      (filter.topicIds.length === 0 ||
        helper.topics.some((topic) => filter.topicIds.includes(topic.id))) &&
      (!needle ||
        [helper.displayName, ...helper.topics.map((topic) => topic.name)].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        )),
  );
}

const DAY = { weekday: "short", day: "numeric", month: "short" } as const;
const CLOCK = { hour: "2-digit", minute: "2-digit" } as const;

/** "10:00–13:00" in the event's time zone. */
export function clockRange(interval: AvailabilityInterval, language: string): string {
  return `${formatEventTime(interval.startsAt, language, CLOCK)}–${formatEventTime(interval.endsAt, language, CLOCK)}`;
}

/** An event-zone day heading ("Sat 27 Nov"). */
export function dayLabel(value: string, language: string): string {
  return formatEventTime(value, language, DAY);
}

/** An instant as the event-zone clock, with the day when it is not today ("Sat 27 Nov, 10:42"). */
export function shortMoment(value: string, language: string, now = Date.now()): string {
  return eventDayKey(value) === eventDayKey(now)
    ? formatEventTime(value, language, CLOCK)
    : formatEventTime(value, language, { ...DAY, ...CLOCK });
}

export interface AvailabilityDay {
  key: string;
  label: string;
  ranges: { index: number; interval: AvailabilityInterval; label: string }[];
}

/**
 * H62: intervals grouped by event-zone day, earliest first, as Calendar lists
 * them ("Sat 27 Nov" · "10:00–13:00"). `index` is the position in the input.
 */
export function availabilityDays(
  intervals: AvailabilityInterval[],
  language: string,
): AvailabilityDay[] {
  const days = new Map<string, AvailabilityDay>();
  const ordered = intervals
    .map((interval, index) => ({ interval, index }))
    .sort((a, b) => Date.parse(a.interval.startsAt) - Date.parse(b.interval.startsAt));
  for (const { interval, index } of ordered) {
    const key = eventDayKey(interval.startsAt);
    const day = days.get(key) ?? {
      key,
      label: dayLabel(interval.startsAt, language),
      ranges: [],
    };
    day.ranges.push({ index, interval, label: clockRange(interval, language) });
    days.set(key, day);
  }
  return [...days.values()];
}

export interface PlanDay extends AvailabilityDay {
  /** Where a new range on this day starts (same clock time as the window's start). */
  anchor: Date;
}

/**
 * H62: the day-by-day plan: every event-zone day of the hacking window (else the
 * event window), each with the ranges already stated that day, plus any day
 * outside the window that still holds a range. `index` is the position in
 * `intervals`.
 */
export function planDays(
  window: AvailabilityInterval | null,
  intervals: AvailabilityInterval[],
  language: string,
): PlanDay[] {
  const days = new Map<string, PlanDay>();
  if (window) {
    const start = Date.parse(window.startsAt);
    const end = Date.parse(window.endsAt);
    // Step a day at a time and close with the window's last day: an event ending
    // at an earlier clock time than it starts would otherwise lose that day.
    const stops: number[] = [];
    for (let at = start; at <= end && stops.length < 14; at += 24 * 3_600_000) stops.push(at);
    for (const at of [...stops, end]) {
      const iso = new Date(at).toISOString();
      const key = eventDayKey(iso);
      if (key && !days.has(key)) {
        // On the closing day a new range goes in the event's last two hours.
        const anchor = at === end && stops.length > 0 ? end - 2 * 3_600_000 : at;
        days.set(key, {
          key,
          label: dayLabel(iso, language),
          ranges: [],
          anchor: new Date(anchor),
        });
      }
    }
  }
  for (const day of availabilityDays(intervals, language)) {
    const existing = days.get(day.key);
    if (existing) existing.ranges = day.ranges;
    else days.set(day.key, { ...day, anchor: new Date(day.ranges[0].interval.startsAt) });
  }
  return [...days.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const DAY_MINUTES = 1440;
/** New and tapped times land on half hours, as on the web timeline. */
export const SNAP_MINUTES = 30;
const MINUTE = 60_000;

/** The instant of an event-zone day's midnight. */
function dayStart(dayKey: string, timeZone: string): number {
  return Date.parse(wallClockToInstant(`${dayKey}T00:00`, timeZone) ?? "");
}

/** The part of a stated interval that falls on one event-zone day line. */
export interface DayPiece {
  /** Position of the interval in the input. */
  index: number;
  interval: AvailabilityInterval;
  /** Minutes from the day's midnight, within 0..1440. */
  start: number;
  end: number;
  /** The interval started the day before / continues past midnight. */
  fromPrev: boolean;
  toNext: boolean;
}

/** H62: what to draw on a day's 24-hour line; an interval crossing midnight appears on both days. */
export function dayPieces(
  intervals: AvailabilityInterval[],
  dayKey: string,
  timeZone: string = getEventTimeZone(),
): DayPiece[] {
  const midnight = dayStart(dayKey, timeZone);
  if (!Number.isFinite(midnight)) return [];
  return intervals
    .map((interval, index) => {
      const start = (Date.parse(interval.startsAt) - midnight) / MINUTE;
      const end = (Date.parse(interval.endsAt) - midnight) / MINUTE;
      return {
        index,
        interval,
        start: Math.max(0, start),
        end: Math.min(DAY_MINUTES, end),
        fromPrev: start < 0,
        toNext: end > DAY_MINUTES,
      };
    })
    .filter((piece) => piece.end > piece.start)
    .sort((a, b) => a.start - b.start);
}

/** Minutes of a day line that fall before `notBefore` (the start of hacking), 0..1440. */
export function minutesBefore(
  dayKey: string,
  notBefore: string | null | undefined,
  timeZone: string = getEventTimeZone(),
): number {
  if (!notBefore) return 0;
  const minutes = (Date.parse(notBefore) - dayStart(dayKey, timeZone)) / MINUTE;
  return Number.isFinite(minutes) ? Math.min(DAY_MINUTES, Math.max(0, minutes)) : 0;
}

/** The snapped minute of the day under a touch `x` on a line `width` points wide. */
export function minuteAt(x: number, width: number): number {
  if (width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, x / width));
  return Math.floor((ratio * DAY_MINUTES) / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * H62: a new two-hour interval on a day starting at `minute`, moved after
 * `notBefore` and shortened to the gap before the next stated interval (at
 * least one snap step, so a tap on a taken spot yields an overlap the editor
 * then reports).
 */
export function slotInterval(
  dayKey: string,
  minute: number,
  existing: AvailabilityInterval[],
  notBefore?: string | null,
  timeZone: string = getEventTimeZone(),
): AvailabilityInterval {
  const floor = notBefore ? Date.parse(notBefore) : Number.NEGATIVE_INFINITY;
  const start = Math.max(dayStart(dayKey, timeZone) + minute * MINUTE, floor);
  const next = existing
    .map((item) => Date.parse(item.startsAt))
    .filter((at) => at > start)
    .sort((a, b) => a - b)[0];
  const end = Math.max(
    start + SNAP_MINUTES * MINUTE,
    Math.min(start + 120 * MINUTE, next ?? Number.POSITIVE_INFINITY),
  );
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}
