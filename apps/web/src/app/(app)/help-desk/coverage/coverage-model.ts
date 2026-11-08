import type { CoverageReport, HelpTopic } from "../model";
import { eventDay, minuteOfDay } from "../schedule";

export type CoverageSlot = CoverageReport["slots"][number];

/** A report slot placed on its event day. */
export interface PlacedSlot extends CoverageSlot {
  /** Minutes after the event-zone midnight. */
  minute: number;
}

export interface CoverageDay {
  day: string;
  slots: PlacedSlot[];
  peak: number;
  /** Slots inside the report range with nobody scheduled. */
  gaps: number;
}

/** H67: the report's slots grouped by the event day they start on. */
export function coverageDays(report: CoverageReport, timeZone: string): CoverageDay[] {
  const days = new Map<string, PlacedSlot[]>();
  for (const slot of report.slots) {
    const day = eventDay(slot.startsAt, timeZone);
    const list = days.get(day) ?? [];
    list.push({ ...slot, minute: minuteOfDay(slot.startsAt, timeZone) });
    days.set(day, list);
  }
  return [...days].map(([day, slots]) => ({
    day,
    slots,
    peak: Math.max(0, ...slots.map((slot) => slot.scheduled)),
    gaps: slots.filter((slot) => slot.scheduled === 0).length,
  }));
}

export interface TopicCoverage extends HelpTopic {
  /** Minutes across the range with at least one scheduled helper who knows it. */
  coveredMinutes: number;
  /** Most helpers scheduled at once. */
  peak: number;
  scheduledNow: number;
  availableNow: number;
  /** An open request needs it and no available helper covers it now. */
  uncovered: boolean;
}

/** Per-topic coverage, gaps first, then by covered time. */
export function topicCoverage(report: CoverageReport): TopicCoverage[] {
  const topics = new Map<number, TopicCoverage>();
  const entry = (topic: HelpTopic) => {
    const current = topics.get(topic.id) ?? {
      id: topic.id,
      name: topic.name,
      coveredMinutes: 0,
      peak: 0,
      scheduledNow: 0,
      availableNow: 0,
      uncovered: false,
    };
    topics.set(topic.id, current);
    return current;
  };
  for (const slot of report.slots) {
    const minutes = (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000;
    for (const topic of slot.topics) {
      const current = entry(topic);
      current.coveredMinutes += minutes;
      current.peak = Math.max(current.peak, topic.scheduled);
    }
  }
  for (const topic of report.now.topics) {
    const current = entry(topic);
    current.scheduledNow = topic.scheduled;
    current.availableNow = topic.available;
  }
  for (const topic of report.uncoveredTopics) entry(topic).uncovered = true;
  return [...topics.values()].sort(
    (a, b) =>
      Number(b.uncovered) - Number(a.uncovered) ||
      a.coveredMinutes - b.coveredMinutes ||
      a.name.localeCompare(b.name),
  );
}
