import type { AvailabilityInterval, HelperCard } from "@hackos/shared/help-desk";
import { apiFetch } from "./api";
import { eventDayKey, formatEventTime } from "./event-time";
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
    for (let at = start; at <= end && days.size < 14; at += 24 * 3_600_000) {
      const iso = new Date(at).toISOString();
      const key = eventDayKey(iso);
      if (key && !days.has(key)) {
        days.set(key, { key, label: dayLabel(iso, language), ranges: [], anchor: new Date(at) });
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
