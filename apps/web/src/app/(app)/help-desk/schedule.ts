import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { type AvailabilityInterval, MAX_INTERVAL_MS } from "@hackos/shared/help-desk";

/**
 * Event-day arithmetic for planned availability (H62) and coverage (H67). Every
 * day and clock is the EVENT's wall clock, never the browser's (H45/H47).
 */

export const DAY_MINUTES = 1440;

/** One interval as it reads on the day it starts. */
export interface DayInterval extends AvailabilityInterval {
  /** Minutes after midnight of `day` where the interval starts. */
  start: number;
  /** Minutes after midnight of `day` where it ends, clipped to the day for the timeline. */
  end: number;
  /** The interval continues past midnight into the next day. */
  nextDay: boolean;
}

export interface ScheduleDay {
  /** `yyyy-MM-dd` in the event zone. */
  day: string;
  intervals: DayInterval[];
}

const minutesOf = (wall: string) => Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));

/** `yyyy-MM-dd` of an instant in the event zone, "" when invalid. */
export function eventDay(iso: string, timeZone: string): string {
  return instantToWallClock(iso, timeZone).slice(0, 10);
}

/** Minutes after the event-zone midnight of the instant's own day. */
export function minuteOfDay(iso: string, timeZone: string): number {
  const wall = instantToWallClock(iso, timeZone);
  return wall ? minutesOf(wall) : 0;
}

/** Noon of an event day, a safe instant for formatting the day's name. */
export function dayInstant(day: string, timeZone: string): string {
  return wallClockToInstant(`${day}T12:00`, timeZone) ?? `${day}T12:00:00Z`;
}

/** The next `yyyy-MM-dd`. */
export function nextDayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Intervals grouped by the event day they start on, both in time order. */
export function scheduleDays(intervals: AvailabilityInterval[], timeZone: string): ScheduleDay[] {
  const days = new Map<string, DayInterval[]>();
  const sorted = [...intervals].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  for (const interval of sorted) {
    const startWall = instantToWallClock(interval.startsAt, timeZone);
    const endWall = instantToWallClock(interval.endsAt, timeZone);
    if (!startWall || !endWall) continue;
    const day = startWall.slice(0, 10);
    const nextDay = endWall.slice(0, 10) !== day;
    const list = days.get(day) ?? [];
    list.push({
      ...interval,
      start: minutesOf(startWall),
      end: nextDay ? DAY_MINUTES : minutesOf(endWall),
      nextDay,
    });
    days.set(day, list);
  }
  return [...days].map(([day, list]) => ({ day, intervals: list }));
}

/**
 * The interval a person means by "day, from, to" in the event zone. An end at
 * or before the start continues into the next day (an overnight shift).
 */
export function intervalFrom(
  day: string,
  from: string,
  to: string,
  timeZone: string,
): AvailabilityInterval | null {
  if (!day || !from || !to) return null;
  const startsAt = wallClockToInstant(`${day}T${from}`, timeZone);
  const endDay = to <= from ? nextDayOf(day) : day;
  const endsAt = wallClockToInstant(`${endDay}T${to}`, timeZone);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

export type IntervalProblem = "tooLong" | "overlap";

/** Why the API would refuse adding `candidate` to `existing` (H62), or null. */
export function intervalProblem(
  candidate: AvailabilityInterval,
  existing: AvailabilityInterval[],
): IntervalProblem | null {
  const start = Date.parse(candidate.startsAt);
  const end = Date.parse(candidate.endsAt);
  if (end - start > MAX_INTERVAL_MS) return "tooLong";
  const overlaps = existing.some(
    (other) => Date.parse(other.startsAt) < end && start < Date.parse(other.endsAt),
  );
  return overlaps ? "overlap" : null;
}

/** Whole minutes between two instants. */
export function durationMinutes(interval: AvailabilityInterval): number {
  return Math.round((Date.parse(interval.endsAt) - Date.parse(interval.startsAt)) / 60_000);
}
