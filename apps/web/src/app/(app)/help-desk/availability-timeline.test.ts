import { describe, expect, it } from "vitest";
import { adjustment, minuteAt } from "./availability-timeline";

const block = { start: 600, end: 720 };

describe("availability timeline drag math", () => {
  it("snaps the pointer to half hours inside the track", () => {
    expect(minuteAt(1000, 0, 2400)).toBe(600);
    expect(minuteAt(1040, 0, 2400)).toBe(630);
    expect(minuteAt(-50, 0, 2400)).toBe(0);
    expect(minuteAt(5000, 0, 2400)).toBe(1440);
  });

  it("moves a block without leaving the day", () => {
    expect(adjustment("move", block, 60)).toEqual({ startDelta: 60, endDelta: 60 });
    expect(adjustment("move", block, -900)).toEqual({ startDelta: -600, endDelta: -600 });
    expect(adjustment("move", block, 2000)).toEqual({ startDelta: 720, endDelta: 720 });
  });

  it("resizes an edge but keeps at least one step of length", () => {
    expect(adjustment("end", block, 60)).toEqual({ startDelta: 0, endDelta: 60 });
    expect(adjustment("end", block, -600)).toEqual({ startDelta: 0, endDelta: -90 });
    expect(adjustment("start", block, -60)).toEqual({ startDelta: -60, endDelta: 0 });
    expect(adjustment("start", block, 600)).toEqual({ startDelta: 90, endDelta: 0 });
  });
});
