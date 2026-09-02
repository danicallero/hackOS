import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import {
  deriveViewerScheduleSegments,
  matchesScheduleSegmentFilter,
} from "./schedule-audience-filter";

// H59 follow-up: the general schedule viewer's own audience filter derives
// its options purely from what the API already sent this caller — never a
// separate capability/role lookup. These fixtures stand in for what
// /api/public/activities returns to each kind of caller (schedule.ts's
// listScheduleForAudiences): a pure participant only ever gets
// `participant`-tagged items; a staff caller additionally gets staff-only
// (empty-audience) items; a sponsor rep additionally gets `sponsor`-tagged
// ones on top of `participant`.

function item(overrides: Partial<PublicScheduleItem> = {}): PublicScheduleItem {
  return {
    id: 1,
    title: "Opening ceremony",
    description: null,
    location: null,
    type: null,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:00:00.000Z",
    publishAt: null,
    audiences: ["participant"],
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

describe("deriveViewerScheduleSegments", () => {
  it("a pure participant's feed yields a single (trivial) segment", () => {
    const items = [
      item({ id: 1, audiences: ["participant"] }),
      item({ id: 2, audiences: ["participant"] }),
    ];
    expect(deriveViewerScheduleSegments(items)).toEqual(["participant"]);
  });

  it("a staff caller's feed yields staff + participant segments", () => {
    const items = [
      item({ id: 1, audiences: [] }), // staff-only item, only ever sent to staff
      item({ id: 2, audiences: ["participant"] }),
    ];
    expect(deriveViewerScheduleSegments(items)).toEqual(["staff", "participant"]);
  });

  it("a sponsor rep's feed yields sponsor + participant segments", () => {
    const items = [
      item({ id: 1, audiences: ["sponsor"] }),
      item({ id: 2, audiences: ["participant"] }),
    ];
    expect(deriveViewerScheduleSegments(items)).toEqual(["sponsor", "participant"]);
  });

  it("a mentor's feed yields only the mentor segment (mutually exclusive with participant)", () => {
    const items = [item({ id: 1, audiences: ["mentor"] })];
    expect(deriveViewerScheduleSegments(items)).toEqual(["mentor"]);
  });

  it("an item carrying multiple tags contributes each of them", () => {
    const items = [item({ id: 1, audiences: ["sponsor", "participant"] })];
    expect(deriveViewerScheduleSegments(items)).toEqual(["sponsor", "participant"]);
  });

  it("returns an empty list for no items", () => {
    expect(deriveViewerScheduleSegments([])).toEqual([]);
  });
});

describe("matchesScheduleSegmentFilter", () => {
  it("with nothing selected, every item matches (unfiltered default)", () => {
    expect(matchesScheduleSegmentFilter(item({ audiences: ["mentor"] }), new Set())).toBe(true);
  });

  it("matches a staff-only (empty-audience) item only against the staff segment", () => {
    const staffOnly = item({ audiences: [] });
    expect(matchesScheduleSegmentFilter(staffOnly, new Set(["staff"]))).toBe(true);
    expect(matchesScheduleSegmentFilter(staffOnly, new Set(["participant"]))).toBe(false);
  });

  it("matches a tagged item against any of its tags", () => {
    const tagged = item({ audiences: ["sponsor", "participant"] });
    expect(matchesScheduleSegmentFilter(tagged, new Set(["sponsor"]))).toBe(true);
    expect(matchesScheduleSegmentFilter(tagged, new Set(["participant"]))).toBe(true);
    expect(matchesScheduleSegmentFilter(tagged, new Set(["mentor"]))).toBe(false);
  });

  it("supports combined selections (staff + sponsor)", () => {
    const selected = new Set<"staff" | "sponsor">(["staff", "sponsor"]);
    expect(matchesScheduleSegmentFilter(item({ audiences: [] }), selected)).toBe(true);
    expect(matchesScheduleSegmentFilter(item({ audiences: ["sponsor"] }), selected)).toBe(true);
    expect(matchesScheduleSegmentFilter(item({ audiences: ["participant"] }), selected)).toBe(
      false,
    );
  });
});
