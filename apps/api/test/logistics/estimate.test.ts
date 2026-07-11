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
 * assertions are exact. SUSPICIOUS_GAP default = 12h (wide enough that a quiet
 * afternoon of hacking with no scan isn't mistaken for having left, narrow
 * enough that an overnight gap still is). This is a read-only likelihood
 * estimate — it never represents the raw door-session state, which is
 * enforced separately at write time (see presence.test.ts's open/closed
 * session guard).
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
    const [interval] = buildPresenceIntervals(events, at(24));
    expect(interval?.confirmed).toBe(true); // closed by a real door 'out'
  });

  it("a quiet afternoon with no scans is not mistaken for having left", () => {
    // in at 09:00, next signal 6h later (well within the 12h window) — must
    // stay a single continuous interval, not split into an "exit + re-entry".
    const events: PresenceEvent[] = [
      { t: at(9), kind: "in" },
      { t: at(15), kind: "activity" },
    ];
    const intervals = buildPresenceIntervals(events, at(24));
    expect(intervals).toHaveLength(1);
    expect(isPresentAt(events, at(13))).toBe(true); // 4h gap, no scan in between
  });

  it("dinner but no breakfast = slept elsewhere (no overnight credit)", () => {
    // dinner Sat 21:00, next signal is breakfast Sun 11:00 — a 14h gap, past
    // the 12h suspicious-gap window, so it's never credited as one session.
    const events: PresenceEvent[] = [
      { t: at(21), kind: "activity" },
      { t: at(35), kind: "activity" }, // Sunday 11:00
    ];
    const intervals = buildPresenceIntervals(events, at(48));
    // two separate intervals — the overnight gap itself is never credited
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toEqual({ start: at(21), end: at(33), confirmed: false });
    expect(intervals[1]).toEqual({ start: at(35), end: at(47), confirmed: false });
    // not present in the middle of the overnight gap
    expect(isPresentAt(events, at(34))).toBe(false);
  });

  it("workshop before lunch extends the morning presence continuously", () => {
    const events: PresenceEvent[] = [
      { t: at(11), kind: "activity" }, // workshop
      { t: at(14), kind: "activity" }, // lunch, well within the window
    ];
    const intervals = buildPresenceIntervals(events, at(24));
    // one continuous interval starting at the workshop (morning extended back)
    expect(intervals).toHaveLength(1);
    const [morning] = intervals;
    expect(morning?.start).toBe(at(11));
    expect(morning?.confirmed).toBe(false);
    expect(isPresentAt(events, at(13))).toBe(true); // between workshop and lunch
  });

  it("meal-only participant across a full day accrues the whole (capped) day", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "activity" }, // breakfast
      { t: at(14), kind: "activity" }, // lunch
      { t: at(21), kind: "activity" }, // dinner
    ];
    // each meal extends the presumed window past the next one, merging into a
    // single day-long presence, capped by MAX_SESSION (16h) from the first scan.
    expect(hours(events, at(30))).toBe(16);
  });

  it("out authoritatively closes a presumed interval at the out time", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "activity" },
      { t: at(10), kind: "out" },
    ];
    expect(hours(events, at(24))).toBe(1);
    expect(isPresentAt(events, at(11))).toBe(false);
    const [interval] = buildPresenceIntervals(events, at(24));
    expect(interval?.confirmed).toBe(true);
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
    expect(isPresentAt(events, at(10))).toBe(true); // within the 12h window
    expect(isPresentAt(events, at(22))).toBe(false); // window lapsed, no further signal
    const intervals = buildPresenceIntervals(events, at(10));
    expect(intervals[0]?.confirmed).toBe(false); // still open, no real 'out' yet
  });
});
