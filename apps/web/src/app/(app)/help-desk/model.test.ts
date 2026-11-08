import { describe, expect, it } from "vitest";
import { validIntervals } from "./model";

describe("helper availability replacement (H62)", () => {
  it("accepts distinct days, adjacent intervals, and clearing availability", () => {
    expect(validIntervals([])).toBe(true);
    expect(
      validIntervals([
        { startsAt: "2027-02-27T10:00:00Z", endsAt: "2027-02-27T12:00:00Z" },
        { startsAt: "2027-02-27T12:00:00Z", endsAt: "2027-02-27T13:00:00Z" },
        { startsAt: "2027-02-28T10:00:00Z", endsAt: "2027-02-28T12:00:00Z" },
      ]),
    ).toBe(true);
  });
  it("rejects overlaps even out of order, reversed dates, blank dates, and intervals over a day", () => {
    expect(
      validIntervals([
        { startsAt: "2027-02-27T11:00:00Z", endsAt: "2027-02-27T13:00:00Z" },
        { startsAt: "2027-02-27T10:00:00Z", endsAt: "2027-02-27T12:00:00Z" },
      ]),
    ).toBe(false);
    expect(
      validIntervals([{ startsAt: "2027-02-27T12:00:00Z", endsAt: "2027-02-27T10:00:00Z" }]),
    ).toBe(false);
    expect(validIntervals([{ startsAt: "", endsAt: "" }])).toBe(false);
    expect(
      validIntervals([{ startsAt: "2027-02-27T10:00:00Z", endsAt: "2027-02-28T10:01:00Z" }]),
    ).toBe(false);
  });
});
