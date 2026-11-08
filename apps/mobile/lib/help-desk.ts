import type { AvailabilityInterval } from "@hackos/shared/help-desk";
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
export { coverageDays, validAvailability, validHelpRequest } from "@hackos/shared/help-desk";

export const canBrowseHelpDesk = canUseHelpDesk;
export function helpMutation<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
