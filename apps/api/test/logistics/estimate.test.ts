import { describe, expect, it } from "vitest";
import {
  buildPresenceIntervals,
  isPresentAt,
  type PresenceEvent,
  totalPresenceMs,
} from "../../src/modules/logistics/estimate.js";

/**
 * H24 presence estimation — deterministic unit tests over the pure algorithm,
 * including the story's canonical cases. Times are millis from a fixed base so
 * assertions are exact. PRESUMED_STAY default = 3h.
 */

const H = 3_600_000;
const base = Date.UTC(2026, 6, 4, 0, 0, 0); // Sat 2026-07-04 00:00 UTC
const at = (hour: number) => base + hour * H;
const hours = (events: PresenceEvent[], cutoff: number) => totalPresenceMs(events, cutoff) / H;

describe("presence estimation (H24)", () => {
  it("door in→out is a full continuous session even with no scans between", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "in" },
      { t: at(18), kind: "out" },
    ];
    expect(hours(events, at(24))).toBe(9);
    expect(isPresentAt(events, at(12))).toBe(true);
    expect(isPresentAt(events, at(19))).toBe(false);
  });

  it("dinner but no breakfast = slept elsewhere (no overnight credit)", () => {
    // dinner Sat 21:00, next signal is breakfast Sun 09:00 (33h base offset)
    const events: PresenceEvent[] = [
      { t: at(21), kind: "activity" },
      { t: at(33), kind: "activity" }, // Sunday 09:00
    ];
    const intervals = buildPresenceIntervals(events, at(48));
    // two separate ~3h intervals, the overnight gap is never credited
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toEqual({ start: at(21), end: at(24) });
    expect(intervals[1]).toEqual({ start: at(33), end: at(36) });
    expect(hours(events, at(48))).toBe(6);
    // not present overnight
    expect(isPresentAt(events, at(28))).toBe(false);
  });

  it("workshop before lunch extends the morning presence continuously", () => {
    const events: PresenceEvent[] = [
      { t: at(11), kind: "activity" }, // workshop
      { t: at(14), kind: "activity" }, // lunch, within the 3h window
    ];
    const intervals = buildPresenceIntervals(events, at(24));
    // one continuous interval starting at the workshop (morning extended back)
    expect(intervals).toHaveLength(1);
    const [morning] = intervals;
    expect(morning?.start).toBe(at(11));
    expect(morning?.end).toBe(at(17)); // lunch + 3h
    expect(isPresentAt(events, at(13))).toBe(true); // between workshop and lunch
  });

  it("meal-only participant still accrues reasonable hours", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "activity" }, // breakfast
      { t: at(14), kind: "activity" }, // lunch
      { t: at(21), kind: "activity" }, // dinner
    ];
    // three ~3h blocks (gaps exceed the 3h window between meals)
    expect(hours(events, at(30))).toBe(9);
  });

  it("out authoritatively closes a presumed interval at the out time", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "activity" },
      { t: at(10), kind: "out" },
    ];
    expect(hours(events, at(24))).toBe(1);
    expect(isPresentAt(events, at(11))).toBe(false);
  });

  it("caps a single interval so a stray far-apart out cannot over-credit", () => {
    const events: PresenceEvent[] = [
      { t: at(0), kind: "in" },
      { t: at(48), kind: "out" }, // two days later
    ];
    expect(hours(events, at(72))).toBe(16); // MAX_SESSION cap
  });

  it("currently open door-in counts as present up to now, capped by window", () => {
    const events: PresenceEvent[] = [{ t: at(9), kind: "in" }];
    expect(isPresentAt(events, at(10))).toBe(true); // within 3h window
    expect(isPresentAt(events, at(13))).toBe(false); // window lapsed, no further signal
  });
});
