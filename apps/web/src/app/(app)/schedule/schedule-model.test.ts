import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import {
  editingNavigationDirection,
  MAX_INLINE_ROLLED_HOURS,
  parseTimeOfDay,
  scheduleDayKey,
  scheduleDuration,
  scheduleNavigationDirection,
  scheduleStatus,
  timeInputValue,
  withDate,
  withTimeOfDay,
  withTimeOfDayAcrossMidnight,
} from "./schedule-model";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

function item(overrides: Partial<PublicScheduleItem> = {}): PublicScheduleItem {
  return {
    id: 1,
    title: "Workshop",
    description: null,
    location: null,
    type: "workshop",
    requiresScan: false,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:00:00.000Z",
    visibility: "hidden",
    publishAt: null,
    // Most fixtures below are about the audience-having visibility states
    // (draft/scheduled/public); the staff-only branch (no audience tag) gets
    // its own case below.
    audiences: ["participant"],
    ...overrides,
  };
}

describe("scheduleStatus", () => {
  it("distinguishes draft and scheduled unpublished items", () => {
    expect(scheduleStatus(item(), NOW)).toBe("draft");
    expect(scheduleStatus(item({ publishAt: "2026-07-22T12:01:00.000Z" }), NOW)).toBe("scheduled");
  });

  it("reads visibility, not a spent publish date, so hiding a published item sticks", () => {
    // publish_at stays behind after the publisher worker reveals an item, so a
    // past date on a hidden item means it was hidden again by hand.
    expect(scheduleStatus(item({ publishAt: "2026-07-22T11:59:00.000Z" }), NOW)).toBe("draft");
    expect(
      scheduleStatus(item({ visibility: "shown", publishAt: "2026-07-22T11:59:00.000Z" }), NOW),
    ).toBe("public");
  });

  it("ignores the item's own time window — a run-of-show lists past and future alike", () => {
    for (const window of [
      // Running right now.
      { startsAt: "2026-07-22T11:00:00.000Z", endsAt: "2026-07-22T13:00:00.000Z" },
      // Long over.
      { startsAt: "2026-07-22T10:00:00.000Z", endsAt: "2026-07-22T12:00:00.000Z" },
    ]) {
      expect(scheduleStatus(item({ visibility: "shown", ...window }), NOW)).toBe("public");
      expect(scheduleStatus(item({ visibility: "hidden", ...window }), NOW)).toBe("draft");
      expect(scheduleStatus(item({ audiences: [], ...window }), NOW)).toBe("staffOnly");
    }
  });

  it("an item with no audience is always staffOnly, regardless of visibility/publishAt (H59 follow-up)", () => {
    expect(
      scheduleStatus(item({ audiences: [], visibility: "hidden", publishAt: null }), NOW),
    ).toBe("staffOnly");
    // Never "draft"/"scheduled"/"public" even if those fields were somehow
    // still set — the API itself forces them back to hidden/null the moment
    // audiences goes empty (schedule_visibility_requires_audience, 0720),
    // but the client-side status derivation stays defensive regardless.
    expect(
      scheduleStatus(
        item({ audiences: [], visibility: "shown", publishAt: "2026-07-22T11:59:00.000Z" }),
        NOW,
      ),
    ).toBe("staffOnly");
  });
});

describe("keyboard grid navigation", () => {
  it("maps Tab and the four arrows onto grid directions", () => {
    expect(scheduleNavigationDirection({ key: "Tab" })).toBe("next");
    expect(scheduleNavigationDirection({ key: "Tab", shiftKey: true })).toBe("previous");
    expect(scheduleNavigationDirection({ key: "ArrowLeft" })).toBe("previousInRow");
    expect(scheduleNavigationDirection({ key: "ArrowRight" })).toBe("nextInRow");
    expect(scheduleNavigationDirection({ key: "ArrowUp" })).toBe("previousInColumn");
    expect(scheduleNavigationDirection({ key: "ArrowDown" })).toBe("nextInColumn");
    expect(scheduleNavigationDirection({ key: "Enter" })).toBeNull();
    expect(scheduleNavigationDirection({ key: "a" })).toBeNull();
  });

  it("leaves the horizontal arrows to the caret while a cell is being edited", () => {
    expect(editingNavigationDirection({ key: "ArrowLeft" })).toBeNull();
    expect(editingNavigationDirection({ key: "ArrowRight" })).toBeNull();
    // Everything else still commits and moves.
    expect(editingNavigationDirection({ key: "ArrowUp" })).toBe("previousInColumn");
    expect(editingNavigationDirection({ key: "ArrowDown" })).toBe("nextInColumn");
    expect(editingNavigationDirection({ key: "Tab" })).toBe("next");
    expect(editingNavigationDirection({ key: "Tab", shiftKey: true })).toBe("previous");
  });
});

describe("scheduleDuration", () => {
  it("computes h:mm between two timestamps", () => {
    expect(scheduleDuration("2026-07-22T08:00:00.000Z", "2026-07-22T09:30:00.000Z")).toBe("1:30");
    expect(scheduleDuration("2026-07-22T08:00:00.000Z", "2026-07-22T08:05:00.000Z")).toBe("0:05");
  });

  it("is empty when the window is invalid or non-positive", () => {
    expect(scheduleDuration("2026-07-22T09:00:00.000Z", "2026-07-22T08:00:00.000Z")).toBe("");
    expect(scheduleDuration("not-a-date", "2026-07-22T08:00:00.000Z")).toBe("");
  });
});

describe("timeInputValue / withTimeOfDay", () => {
  it("round-trips a new time-of-day onto the original date", () => {
    const original = new Date("2026-07-22T08:00:00.000").toISOString();
    const next = withTimeOfDay(original, "14:30");
    expect(next).not.toBeNull();
    expect(timeInputValue(next as string)).toBe("14:30");
    // The calendar date itself is untouched.
    expect(new Date(next as string).toDateString()).toBe(new Date(original).toDateString());
  });

  it("rejects a malformed time or timestamp", () => {
    expect(withTimeOfDay("2026-07-22T08:00:00.000Z", "not-a-time")).toBeNull();
    expect(withTimeOfDay("not-a-date", "14:30")).toBeNull();
  });
});

describe("parseTimeOfDay", () => {
  it("reads a time typed at speed and returns it canonical", () => {
    expect(parseTimeOfDay("9")).toBe("09:00");
    expect(parseTimeOfDay("9:0")).toBe("09:00");
    expect(parseTimeOfDay("9:5")).toBe("09:05");
    expect(parseTimeOfDay("09:00")).toBe("09:00");
    expect(parseTimeOfDay("930")).toBe("09:30");
    expect(parseTimeOfDay("0930")).toBe("09:30");
    expect(parseTimeOfDay("2345")).toBe("23:45");
    expect(parseTimeOfDay("23:45")).toBe("23:45");
    expect(parseTimeOfDay("0")).toBe("00:00");
    expect(parseTimeOfDay("00:00")).toBe("00:00");
  });

  it("accepts the separators people actually type, and stray spaces", () => {
    expect(parseTimeOfDay(" 9.30 ")).toBe("09:30");
    expect(parseTimeOfDay("9,30")).toBe("09:30");
    expect(parseTimeOfDay("9h30")).toBe("09:30");
    expect(parseTimeOfDay("9h")).toBe("09:00");
    expect(parseTimeOfDay("9:")).toBe("09:00");
  });

  it("rejects rather than wraps an impossible time", () => {
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("9:75")).toBeNull();
    expect(parseTimeOfDay("2475")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
    expect(parseTimeOfDay("12345")).toBeNull();
  });
});

describe("withTimeOfDayAcrossMidnight", () => {
  // Local wall-clock fixtures on purpose: the cell edits a clock, not an instant.
  const startsAt = new Date("2026-08-28T23:00:00").toISOString();
  const endsAt = new Date("2026-08-28T23:30:00").toISOString();

  function ok(result: ReturnType<typeof withTimeOfDayAcrossMidnight>) {
    if (!result.ok) throw new Error(`expected an accepted edit, got ${result.reason}`);
    return result;
  }

  it("rolls the end into the next day when it would land before the start", () => {
    const next = ok(withTimeOfDayAcrossMidnight(startsAt, endsAt, "endsAt", "00:00"));
    expect(next.startsAt).toBe(startsAt);
    expect(next.rolledToNextDay).toBe(true);
    expect(timeInputValue(next.endsAt)).toBe("00:00");
    expect(scheduleDayKey(next.endsAt)).toBe("2026-08-29");
    expect(scheduleDuration(startsAt, next.endsAt)).toBe("1:00");
  });

  it("leaves a same-day window alone", () => {
    const next = ok(withTimeOfDayAcrossMidnight(startsAt, endsAt, "endsAt", "23:45"));
    expect(next.rolledToNextDay).toBe(false);
    expect(scheduleDayKey(next.endsAt)).toBe("2026-08-28");
    expect(scheduleDuration(startsAt, next.endsAt)).toBe("0:45");
  });

  it("pushes the end over midnight when the start moves past it", () => {
    // A 01:00-02:00 item re-timed to start at 22:00 is a night session: the
    // end is the side that crosses over, giving 22:00 -> 02:00.
    const lateNight = new Date("2026-08-29T01:00:00").toISOString();
    const lateNightEnd = new Date("2026-08-29T02:00:00").toISOString();
    const next = ok(withTimeOfDayAcrossMidnight(lateNight, lateNightEnd, "startsAt", "22:00"));
    expect(timeInputValue(next.startsAt)).toBe("22:00");
    expect(next.rolledToNextDay).toBe(true);
    expect(scheduleDayKey(next.startsAt)).toBe("2026-08-29");
    expect(scheduleDayKey(next.endsAt)).toBe("2026-08-30");
    expect(scheduleDuration(next.startsAt, next.endsAt)).toBe("4:00");
  });

  it("refuses a start nudged just past its end — that is a typo, not a 23-hour item", () => {
    expect(withTimeOfDayAcrossMidnight(startsAt, endsAt, "startsAt", "23:40")).toEqual({
      ok: false,
      reason: "rolledWindowTooLong",
    });
  });

  it("rolls a night session right up to the cap", () => {
    const evening = new Date("2026-08-28T20:00:00").toISOString();
    const next = ok(withTimeOfDayAcrossMidnight(evening, endsAt, "endsAt", "08:00"));
    expect(scheduleDayKey(next.endsAt)).toBe("2026-08-29");
    expect(scheduleDuration(next.startsAt, next.endsAt)).toBe(`${MAX_INLINE_ROLLED_HOURS}:00`);
  });

  it("refuses a roll past the cap — a mistyped time must not move an item to another day", () => {
    const morning = new Date("2026-08-28T09:00:00").toISOString();
    const evening = new Date("2026-08-28T17:00:00").toISOString();
    // "09:00 to 07:00" is a slip, not a 22-hour activity.
    expect(withTimeOfDayAcrossMidnight(morning, evening, "endsAt", "07:00")).toEqual({
      ok: false,
      reason: "rolledWindowTooLong",
    });
    // An end equal to the start would mean a 24 h item; also refused.
    expect(withTimeOfDayAcrossMidnight(morning, evening, "endsAt", "09:00")).toEqual({
      ok: false,
      reason: "rolledWindowTooLong",
    });
  });

  it("still allows a long window that doesn't cross midnight", () => {
    const morning = new Date("2026-08-28T09:00:00").toISOString();
    const next = ok(withTimeOfDayAcrossMidnight(morning, endsAt, "endsAt", "23:59"));
    expect(next.rolledToNextDay).toBe(false);
    expect(scheduleDayKey(next.endsAt)).toBe("2026-08-28");
  });

  it("rejects a malformed time", () => {
    // Out-of-range digits ("24:99") are the cell's job — TIME_24H_PATTERN
    // rejects them before this is ever called.
    expect(withTimeOfDayAcrossMidnight(startsAt, endsAt, "endsAt", "not-a-time")).toEqual({
      ok: false,
      reason: "invalidTime",
    });
  });
});

describe("scheduleDayKey / withDate", () => {
  it("groups by the local calendar day and moves an item to a YYYY-MM-DD target", () => {
    const original = "2026-08-27T08:00:00.000Z";
    const next = withDate(original, "2026-08-28");

    expect(next).not.toBeNull();
    expect(scheduleDayKey(next as string)).toBe("2026-08-28");
    expect(timeInputValue(next as string)).toBe(timeInputValue(original));
  });

  it("rejects invalid source and target dates", () => {
    expect(withDate("not-a-date", "2026-08-28")).toBeNull();
    expect(withDate("2026-08-27T08:00:00.000Z", "not-a-date")).toBeNull();
  });
});
