import { describe, expect, it } from "vitest";
import { dragged, minuteAt, piecesOf } from "./availability-timeline";

const block = { start: 600, end: 720 };

describe("availability timeline drag math", () => {
  it("snaps the pointer to half hours inside the track", () => {
    expect(minuteAt(1000, 0, 2400)).toBe(600);
    expect(minuteAt(1040, 0, 2400)).toBe(630);
    expect(minuteAt(-50, 0, 2400)).toBe(0);
    expect(minuteAt(5000, 0, 2400)).toBe(1440);
  });

  it("moves a stretch within the usable range", () => {
    expect(dragged("move", block, 60, 0, 4320)).toEqual({ start: 660, end: 780 });
    expect(dragged("move", block, -900, 0, 4320)).toEqual({ start: 0, end: 120 });
    expect(dragged("move", block, -900, 480, 4320)).toEqual({ start: 480, end: 600 });
    expect(dragged("move", block, 9000, 0, 1440)).toEqual({ start: 1320, end: 1440 });
  });

  it("resizes an edge, keeping at least one step of length and never before the lower bound", () => {
    expect(dragged("end", block, 60, 0, 4320)).toEqual({ start: 600, end: 780 });
    expect(dragged("end", block, -600, 0, 4320)).toEqual({ start: 600, end: 630 });
    expect(dragged("start", block, -60, 0, 4320)).toEqual({ start: 540, end: 720 });
    expect(dragged("start", block, -600, 540, 4320)).toEqual({ start: 540, end: 720 });
    expect(dragged("start", block, 600, 0, 4320)).toEqual({ start: 690, end: 720 });
  });

  it("splits a stretch across the day lines it crosses", () => {
    expect(piecesOf({ start: 1260, end: 1620 }, 3)).toEqual([
      { row: 0, start: 1260, end: 1440, fromPrev: false, toNext: true },
      { row: 1, start: 0, end: 180, fromPrev: true, toNext: false },
    ]);
    expect(piecesOf({ start: 600, end: 1440 }, 2)).toEqual([
      { row: 0, start: 600, end: 1440, fromPrev: false, toNext: false },
    ]);
  });
});
