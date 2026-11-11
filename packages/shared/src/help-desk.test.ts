import { describe, expect, it } from "vitest";
import { coverageDays, validAvailability, validHelpRequest } from "./help-desk";

const interval = (start: string, end: string) => ({
  startsAt: `2027-02-${start}:00.000Z`,
  endsAt: `2027-02-${end}:00.000Z`,
});

describe("help desk client validation (H62, H64)", () => {
  it("allows multiple days, adjoining intervals, an unordered set and clearing the schedule", () => {
    expect(validAvailability([])).toBe(true);
    expect(
      validAvailability([interval("20T09:00", "20T10:00"), interval("21T09:00", "21T10:00")]),
    ).toBe(true);
    expect(
      validAvailability([interval("20T10:00", "20T11:00"), interval("20T09:00", "20T10:00")]),
    ).toBe(true);
  });
  it("rejects overlaps, reversed/invalid dates, intervals longer than a day and excess intervals", () => {
    expect(
      validAvailability([interval("20T09:00", "20T11:00"), interval("20T10:00", "20T12:00")]),
    ).toBe(false);
    expect(validAvailability([interval("20T11:00", "20T09:00")])).toBe(false);
    expect(validAvailability([{ startsAt: "invalid", endsAt: "invalid" }])).toBe(false);
    expect(validAvailability([interval("20T09:00", "21T10:00")])).toBe(false);
    expect(
      validAvailability(Array.from({ length: 31 }, () => interval("20T09:00", "20T10:00"))),
    ).toBe(false);
  });
  it("requires a real description, location and a topic or Other within API bounds", () => {
    const topic = { id: 1, name: "Frontend" };
    expect(validHelpRequest("Debug a build", "Desk 5", [topic], false)).toBe(true);
    expect(validHelpRequest("Other need", "Desk 5", [], true)).toBe(true);
    expect(validHelpRequest("Need help", "Desk 5", [], false)).toBe(false);
    expect(validHelpRequest(" ", "Desk 5", [topic], false)).toBe(false);
    expect(validHelpRequest("Need help", " ", [topic], false)).toBe(false);
    expect(validHelpRequest("x".repeat(501), "Desk 5", [topic], false)).toBe(false);
    expect(validHelpRequest("Need help", "x".repeat(121), [topic], false)).toBe(false);
    expect(
      validHelpRequest(
        "Need help",
        "Desk 5",
        Array.from({ length: 6 }, () => topic),
        false,
      ),
    ).toBe(false);
  });
});

describe("coverage days (H67)", () => {
  const slot = (hour: number, scheduled: number, topics: { id: number; name: string }[] = []) => ({
    startsAt: `2027-02-20T${String(hour).padStart(2, "0")}:00:00.000Z`,
    endsAt: `2027-02-20T${String(hour + 1).padStart(2, "0")}:00:00.000Z`,
    scheduled,
    byKind: { mentor: scheduled, sponsor: 0, staff: 0 },
    topics: topics.map((topic) => ({ ...topic, scheduled: 1 })),
  });
  it("merges equal consecutive slots and keeps gaps as their own runs", () => {
    const frontend = { id: 1, name: "Frontend" };
    const days = coverageDays(
      [
        slot(9, 1, [frontend]),
        slot(10, 1, [frontend]),
        slot(11, 0),
        slot(12, 0),
        slot(13, 2, [frontend]),
      ],
      (iso) => iso.slice(0, 10),
    );
    expect(days).toHaveLength(1);
    expect(
      days[0].runs.map((run) => [
        run.startsAt.slice(11, 16),
        run.endsAt.slice(11, 16),
        run.scheduled,
      ]),
    ).toEqual([
      ["09:00", "11:00", 1],
      ["11:00", "13:00", 0],
      ["13:00", "14:00", 2],
    ]);
  });
  it("starts a new day at the day boundary", () => {
    const days = coverageDays([slot(9, 0), slot(10, 0)], (iso) =>
      iso < "2027-02-20T10" ? "a" : "b",
    );
    expect(days.map((day) => day.key)).toEqual(["a", "b"]);
  });
});
