import { describe, expect, it } from "vitest";
import type { CoverageReport } from "../model";
import { coverageDays, topicCoverage } from "./coverage-model";

const kinds = { mentor: 0, sponsor: 0, staff: 0 };
const slot = (
  startsAt: string,
  endsAt: string,
  scheduled: number,
  topics: { id: number; name: string; scheduled: number }[] = [],
) => ({
  startsAt,
  endsAt,
  scheduled,
  byKind: { ...kinds, mentor: scheduled },
  topics,
});
const report: CoverageReport = {
  from: "2027-02-27T09:00:00Z",
  to: "2027-02-28T10:00:00Z",
  stepMinutes: 60,
  totals: { publishedHelpers: 2, byKind: { mentor: 2, sponsor: 0, staff: 0 } },
  slots: [
    slot("2027-02-27T09:00:00Z", "2027-02-27T10:00:00Z", 2, [
      { id: 1, name: "Frontend", scheduled: 2 },
    ]),
    slot("2027-02-27T10:00:00Z", "2027-02-27T11:00:00Z", 0),
    slot("2027-02-28T09:00:00Z", "2027-02-28T10:00:00Z", 1, [
      { id: 2, name: "Vite", scheduled: 1 },
    ]),
  ],
  now: {
    at: "2027-02-27T09:30:00Z",
    scheduled: 2,
    present: 1,
    available: 1,
    topics: [{ id: 1, name: "Frontend", scheduled: 2, available: 1 }],
  },
  uncoveredTopics: [{ id: 3, name: "Rust" }],
};

describe("coverage (H67)", () => {
  it("places slots on event days with their peak and empty slots", () => {
    const days = coverageDays(report, "Europe/Madrid");
    expect(days.map((day) => [day.day, day.peak, day.gaps, day.slots[0].minute])).toEqual([
      ["2027-02-27", 2, 1, 600],
      ["2027-02-28", 1, 0, 600],
    ]);
  });
  it("lists uncovered topics first, then the least covered", () => {
    expect(
      topicCoverage(report).map((topic) => [topic.name, topic.coveredMinutes, topic.uncovered]),
    ).toEqual([
      ["Rust", 0, true],
      ["Frontend", 60, false],
      ["Vite", 60, false],
    ]);
  });
});
