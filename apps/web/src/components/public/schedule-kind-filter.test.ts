import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { deriveScheduleKinds, matchesScheduleKindFilter } from "./schedule-kind-filter";

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

describe("deriveScheduleKinds", () => {
  it("a single kind across every item yields no options", () => {
    const items = [item({ id: 1, type: "talk" }), item({ id: 2, type: "talk" })];
    expect(deriveScheduleKinds(items)).toEqual(["talk"]);
  });

  it("distinct kinds come back in ACTIVITY_KINDS display order, not item order", () => {
    const items = [item({ id: 1, type: "meal" }), item({ id: 2, type: "workshop" })];
    expect(deriveScheduleKinds(items)).toEqual(["meal", "workshop"]);
  });

  it("an untyped item falls back to the default kind", () => {
    expect(deriveScheduleKinds([item({ type: null })])).toEqual(["activity"]);
  });

  it("returns an empty list for no items", () => {
    expect(deriveScheduleKinds([])).toEqual([]);
  });
});

describe("matchesScheduleKindFilter", () => {
  it("with nothing selected, every item matches (unfiltered default)", () => {
    expect(matchesScheduleKindFilter(item({ type: "meal" }), new Set())).toBe(true);
  });

  it("matches only the selected kind", () => {
    const workshop = item({ type: "workshop" });
    expect(matchesScheduleKindFilter(workshop, new Set(["workshop"]))).toBe(true);
    expect(matchesScheduleKindFilter(workshop, new Set(["meal"]))).toBe(false);
  });

  it("matches an untyped item against the default kind", () => {
    expect(matchesScheduleKindFilter(item({ type: null }), new Set(["activity"]))).toBe(true);
  });
});
