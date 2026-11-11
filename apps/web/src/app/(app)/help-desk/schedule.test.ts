import { describe, expect, it } from "vitest";
import { intervalFrom, intervalProblem, scheduleDays } from "./schedule";

const zone = "Europe/Madrid";

describe("planned availability by event day (H62)", () => {
  it("groups intervals by the event-zone day they start on, in time order", () => {
    const days = scheduleDays(
      [
        { startsAt: "2027-02-28T09:00:00Z", endsAt: "2027-02-28T11:00:00Z" },
        { startsAt: "2027-02-27T09:00:00Z", endsAt: "2027-02-27T12:00:00Z" },
        { startsAt: "2027-02-27T15:00:00Z", endsAt: "2027-02-27T17:00:00Z" },
      ],
      zone,
    );
    expect(days.map((day) => [day.day, day.intervals.map((i) => [i.start, i.end])])).toEqual([
      [
        "2027-02-27",
        [
          [600, 780],
          [960, 1080],
        ],
      ],
      ["2027-02-28", [[600, 720]]],
    ]);
  });
  it("clips an overnight interval at midnight and marks it", () => {
    const [day] = scheduleDays(
      [{ startsAt: "2027-02-27T21:00:00Z", endsAt: "2027-02-28T01:00:00Z" }],
      zone,
    );
    expect(day.intervals[0]).toMatchObject({ start: 1320, end: 1440, nextDay: true });
  });
  it("reads an end at or before the start as the next day, in the event zone", () => {
    expect(intervalFrom("2027-02-27", "10:00", "13:00", zone)).toEqual({
      startsAt: "2027-02-27T09:00:00.000Z",
      endsAt: "2027-02-27T12:00:00.000Z",
    });
    expect(intervalFrom("2027-02-27", "22:00", "02:00", zone)?.endsAt).toBe(
      "2027-02-28T01:00:00.000Z",
    );
    expect(intervalFrom("", "10:00", "13:00", zone)).toBeNull();
  });
  it("names overlap and over-long intervals; adjacent intervals are fine", () => {
    const existing = [{ startsAt: "2027-02-27T09:00:00Z", endsAt: "2027-02-27T12:00:00Z" }];
    expect(
      intervalProblem(
        { startsAt: "2027-02-27T11:00:00Z", endsAt: "2027-02-27T13:00:00Z" },
        existing,
      ),
    ).toBe("overlap");
    expect(
      intervalProblem(
        { startsAt: "2027-02-27T12:00:00Z", endsAt: "2027-02-27T13:00:00Z" },
        existing,
      ),
    ).toBeNull();
    // 10:00 to 10:00 across the October clock change lasts 25 hours.
    const dst = intervalFrom("2027-10-30", "10:00", "10:00", zone)!;
    expect(intervalProblem(dst, [])).toBe("tooLong");
  });
});
