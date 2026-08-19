import {
  type CertaintyWindowFull,
  detectPresenceDivergence,
  durationMinutes,
  securedWindowFraction,
} from "./presence-timeline";

describe("presence timeline helpers", () => {
  test("calculates and clamps the secured part of a certainty window", () => {
    const base = {
      start: "2026-07-15T08:00:00.000Z",
      deadline: "2026-07-15T20:00:00.000Z",
    };

    expect(securedWindowFraction({ ...base, securedUntil: null })).toBe(0);
    expect(securedWindowFraction({ ...base, securedUntil: "2026-07-15T14:00:00.000Z" })).toBe(0.5);
    expect(securedWindowFraction({ ...base, securedUntil: "2026-07-16T08:00:00.000Z" })).toBe(1);
  });

  test("returns a non-negative rounded duration", () => {
    expect(durationMinutes("2026-07-15T08:00:00.000Z", "2026-07-15T09:30:00.000Z")).toBe(90);
    expect(durationMinutes("2026-07-15T10:00:00.000Z", "2026-07-15T09:00:00.000Z")).toBe(0);
  });

  describe("detectPresenceDivergence", () => {
    const secured: CertaintyWindowFull = {
      start: "2026-07-15T08:00:00.000Z",
      deadline: "2026-07-15T20:00:00.000Z",
      securedUntil: "2026-07-15T10:00:00.000Z",
      status: "secured",
      openedBy: "in",
      conflict: false,
    };

    test("ignores everything when the door already suggests an exit", () => {
      expect(detectPresenceDivergence([secured], "out")).toEqual({
        primaryOverride: null,
        secondary: null,
      });
    });

    test("suggests closing + backfilling an activity-only open window", () => {
      const activityOpen: CertaintyWindowFull = {
        ...secured,
        securedUntil: null,
        status: "provisional",
        openedBy: "activity",
      };
      expect(detectPresenceDivergence([secured, activityOpen], "in")).toEqual({
        primaryOverride: "out",
        secondary: { kind: "in", reason: "activity-open", at: activityOpen.start },
      });
    });

    test("offers a backdated-exit fix for a plain timed-out window", () => {
      const timedOut: CertaintyWindowFull = { ...secured, securedUntil: null, status: "invalid" };
      expect(detectPresenceDivergence([timedOut], "in")).toEqual({
        primaryOverride: null,
        secondary: { kind: "out", reason: "invalid-window", at: timedOut.deadline },
      });
    });

    test("leaves the in→in conflict to its own dedicated banner", () => {
      const conflicted: CertaintyWindowFull = {
        ...secured,
        securedUntil: null,
        status: "invalid",
        conflict: true,
      };
      expect(detectPresenceDivergence([conflicted], "in")).toEqual({
        primaryOverride: null,
        secondary: null,
      });
    });

    test("leaves an unresolved conflict on an earlier window to its own banner, even when a later window has separately timed out", () => {
      const conflicted: CertaintyWindowFull = {
        ...secured,
        securedUntil: null,
        status: "invalid",
        conflict: true,
      };
      // The second `in` that caused the conflict opens its own fresh window,
      // which can independently time out with no exit ever following it.
      const laterTimedOut: CertaintyWindowFull = {
        ...secured,
        start: "2026-07-16T08:00:00.000Z",
        deadline: "2026-07-16T20:00:00.000Z",
        securedUntil: null,
        status: "invalid",
        conflict: false,
      };
      expect(detectPresenceDivergence([conflicted, laterTimedOut], "in")).toEqual({
        primaryOverride: null,
        secondary: null,
      });
    });

    test("does nothing with no windows at all", () => {
      expect(detectPresenceDivergence([], "in")).toEqual({
        primaryOverride: null,
        secondary: null,
      });
    });
  });
});
