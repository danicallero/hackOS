import { describe, expect, it } from "vitest";
import {
  buildCertaintyWindows,
  buildPresenceIntervals,
  guaranteedPresenceMs,
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
const guaranteedHours = (events: PresenceEvent[], cutoff: number) =>
  guaranteedPresenceMs(events, cutoff) / H;

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
    expect(intervals).toHaveLength(2);
    expect(isPresentAt(events, at(13))).toBe(true); // 4h gap, no scan in between
  });

  it("invalidates isolated activity windows once certainty expires", () => {
    // dinner Sat 21:00, next signal is breakfast Sun 11:00 — a 14h gap, past
    // the 12h suspicious-gap window, so it's never credited as one session.
    const events: PresenceEvent[] = [
      { t: at(21), kind: "activity" },
      { t: at(35), kind: "activity" }, // Sunday 11:00
    ];
    const intervals = buildPresenceIntervals(events, at(48));
    // Each isolated signal opens a provisional session, but neither receives
    // a confirming exit/activity inside its certainty window.
    expect(intervals).toHaveLength(0);
    expect(isPresentAt(events, at(34))).toBe(false);
  });

  it("workshop before lunch extends the morning presence continuously", () => {
    const events: PresenceEvent[] = [
      { t: at(11), kind: "activity" }, // workshop
      { t: at(14), kind: "activity" }, // lunch, well within the window
    ];
    const intervals = buildPresenceIntervals(events, at(24));
    // One secured segment and the fresh provisional window opened by lunch.
    expect(intervals).toHaveLength(2);
    const [morning] = intervals;
    expect(morning?.start).toBe(at(11));
    expect(morning?.confirmed).toBe(false);
    expect(isPresentAt(events, at(13))).toBe(true); // between workshop and lunch
  });

  it("meal-only participant accrues chained windows without a global session cap", () => {
    const events: PresenceEvent[] = [
      { t: at(9), kind: "activity" }, // breakfast
      { t: at(14), kind: "activity" }, // lunch
      { t: at(21), kind: "activity" }, // dinner
    ];
    expect(hours(events, at(30))).toBe(21);
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

  it("does not let a late exit revive an already invalidated session", () => {
    const events: PresenceEvent[] = [
      { t: at(0), kind: "in" },
      { t: at(48), kind: "out" }, // two days later
    ];
    expect(hours(events, at(72))).toBe(0);
  });

  it("currently open door-in counts as present up to now, capped by window", () => {
    const events: PresenceEvent[] = [{ t: at(9), kind: "in" }];
    expect(isPresentAt(events, at(10))).toBe(true); // within the 12h window
    expect(isPresentAt(events, at(22))).toBe(false); // window lapsed, no further signal
    const intervals = buildPresenceIntervals(events, at(10));
    expect(intervals[0]?.confirmed).toBe(false); // still open, no real 'out' yet
  });
});

describe("rolling certainty windows", () => {
  it("carries only secured time into the anonymous audit record", () => {
    expect(
      guaranteedHours(
        [
          { t: at(9), kind: "in" },
          { t: at(18), kind: "out" },
        ],
        at(24),
      ),
    ).toBe(9);
    expect(guaranteedHours([{ t: at(9), kind: "in" }], at(24))).toBe(0);
  });

  it("does not credit malformed duplicate entries, but keeps the valid later session", () => {
    expect(
      guaranteedHours(
        [
          { t: at(9), kind: "in" },
          { t: at(10), kind: "in" },
          { t: at(12), kind: "out" },
        ],
        at(24),
      ),
    ).toBe(2);
  });

  it("deduplicates repeated exits and does not extend time past the first exit", () => {
    expect(
      guaranteedHours(
        [
          { t: at(9), kind: "in" },
          { t: at(12), kind: "out" },
          { t: at(12), kind: "out" },
        ],
        at(24),
      ),
    ).toBe(3);
  });

  it("secures entry-to-activity and opens a fresh window at the activity", () => {
    const windows = buildCertaintyWindows(
      [
        { t: at(0), kind: "in" },
        { t: at(5), kind: "activity" },
      ],
      at(6),
    );
    expect(windows).toEqual([
      {
        start: at(0),
        deadline: at(12),
        securedUntil: at(5),
        status: "secured",
        openedBy: "in",
        closedBy: "activity",
        conflict: false,
      },
      {
        start: at(5),
        deadline: at(17),
        securedUntil: null,
        status: "provisional",
        openedBy: "activity",
        closedBy: null,
        conflict: false,
      },
    ]);
  });

  it("chains activities and secures each elapsed segment", () => {
    const windows = buildCertaintyWindows(
      [
        { t: at(0), kind: "in" },
        { t: at(5), kind: "activity" },
        { t: at(15), kind: "activity" },
        { t: at(18), kind: "out" },
      ],
      at(20),
    );
    expect(windows.map((window) => [window.start, window.securedUntil, window.closedBy])).toEqual([
      [at(0), at(5), "activity"],
      [at(5), at(15), "activity"],
      [at(15), at(18), "out"],
    ]);
  });

  it("shows an expired unconfirmed window as invalid", () => {
    const [window] = buildCertaintyWindows([{ t: at(0), kind: "in" }], at(13));
    expect(window?.status).toBe("invalid");
    expect(window?.securedUntil).toBeNull();
  });

  it("illegal in→in never secures: the first window is a zero-credit conflict", () => {
    // Only reachable via manual log edits — the scan endpoint rejects it.
    const events: PresenceEvent[] = [
      { t: at(0), kind: "in" },
      { t: at(2), kind: "in" },
      { t: at(4), kind: "out" },
    ];
    const windows = buildCertaintyWindows(events, at(6));
    expect(windows[0]).toMatchObject({
      start: at(0),
      status: "invalid",
      conflict: true,
      securedUntil: null,
    });
    expect(windows[1]).toMatchObject({ start: at(2), status: "secured", conflict: false });
    expect(hours(events, at(6))).toBe(2); // only the second entry's 2h count
  });

  it("flags in→in as a conflict even when the first window already expired", () => {
    const windows = buildCertaintyWindows(
      [
        { t: at(0), kind: "in" },
        { t: at(14), kind: "in" }, // past the 12h deadline
      ],
      at(15),
    );
    expect(windows[0]).toMatchObject({ status: "invalid", conflict: true });
    expect(windows[1]).toMatchObject({ status: "provisional", conflict: false });
  });

  it("an activity between two entries legitimizes the sequence (no conflict)", () => {
    const events: PresenceEvent[] = [
      { t: at(0), kind: "in" },
      { t: at(3), kind: "activity" },
      { t: at(5), kind: "in" },
    ];
    const windows = buildCertaintyWindows(events, at(6));
    expect(windows.every((window) => !window.conflict)).toBe(true);
    expect(windows[0]?.status).toBe("secured"); // in → activity
    expect(windows[1]?.status).toBe("secured"); // activity → in
  });
});
