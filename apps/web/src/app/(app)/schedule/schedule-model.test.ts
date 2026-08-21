import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { scheduleDuration, scheduleStatus, timeInputValue, withTimeOfDay } from "./schedule-model";

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
    // Most fixtures below are about the audience-having timeline states
    // (draft/scheduled/public/active/ended); the staff-only branch (no
    // audience tag) gets its own describe block below.
    audiences: ["participant"],
    ...overrides,
  };
}

describe("scheduleStatus", () => {
  it("distinguishes draft and scheduled unpublished items", () => {
    expect(scheduleStatus(item(), NOW)).toBe("draft");
    expect(scheduleStatus(item({ publishAt: "2026-07-22T12:01:00.000Z" }), NOW)).toBe("scheduled");
  });

  it("makes a due publication public even when visibility remains hidden", () => {
    expect(scheduleStatus(item({ publishAt: "2026-07-22T11:59:00.000Z" }), NOW)).toBe("public");
  });

  it("prioritizes an active or ended time window after publication", () => {
    expect(
      scheduleStatus(
        item({
          visibility: "shown",
          startsAt: "2026-07-22T11:00:00.000Z",
          endsAt: "2026-07-22T13:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("active");
    expect(
      scheduleStatus(
        item({
          visibility: "shown",
          startsAt: "2026-07-22T10:00:00.000Z",
          endsAt: "2026-07-22T12:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("ended");
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

  it("a currently-active or ended staff-only item still tracks its own time window", () => {
    expect(
      scheduleStatus(
        item({
          audiences: [],
          startsAt: "2026-07-22T11:00:00.000Z",
          endsAt: "2026-07-22T13:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("active");
    expect(
      scheduleStatus(
        item({
          audiences: [],
          startsAt: "2026-07-22T10:00:00.000Z",
          endsAt: "2026-07-22T12:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("ended");
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
