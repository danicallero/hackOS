import { activityKinds, closestActivity, filterActivities, sameActivities } from "./activity-list";
import type { ScannerActivity } from "./scanner-types";

function activity(overrides: Partial<ScannerActivity> & { id: number }): ScannerActivity {
  return {
    name: `Activity ${overrides.id}`,
    category: "activity",
    requiresScan: true,
    startsAt: null,
    primaryLanguage: "es",
    nameI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const hours = (offset: number) => new Date(NOW + offset * 3600_000).toISOString();

describe("activityKinds", () => {
  it("lists the present kinds in editor order", () => {
    expect(
      activityKinds([
        activity({ id: 1, category: "talk" }),
        activity({ id: 2, category: "meal" }),
        activity({ id: 3, category: "meal" }),
      ]),
    ).toEqual(["meal", "talk"]);
  });

  it("keeps categories that aren't built-in kinds, sorted after them", () => {
    expect(
      activityKinds([activity({ id: 1, category: "hackathon-only" }), activity({ id: 2 })]),
    ).toEqual(["activity", "hackathon-only"]);
  });
});

describe("filterActivities", () => {
  const items = [
    activity({ id: 1, name: "Cena Sábado", category: "meal" }),
    activity({ id: 2, name: "Charla Grafana", category: "talk" }),
  ];

  it("returns everything with no query and no kind", () => {
    expect(filterActivities(items, { query: "  ", kind: null })).toEqual(items);
  });

  it("matches the name case-insensitively", () => {
    expect(filterActivities(items, { query: "grafana", kind: null })).toEqual([items[1]]);
  });

  it("ANDs the kind filter with the query", () => {
    expect(filterActivities(items, { query: "a", kind: "meal" })).toEqual([items[0]]);
    expect(filterActivities(items, { query: "grafana", kind: "meal" })).toEqual([]);
  });
});

describe("closestActivity", () => {
  it("returns null when nothing is scheduled", () => {
    expect(closestActivity([activity({ id: 1 })], NOW)).toBeNull();
  });

  it("marks the next activity to start", () => {
    expect(
      closestActivity(
        [activity({ id: 1, startsAt: hours(3) }), activity({ id: 2, startsAt: hours(1) })],
        NOW,
      ),
    ).toEqual({ id: 2, running: false });
  });

  it("prefers an activity that just started over a further-off next one", () => {
    expect(
      closestActivity(
        [activity({ id: 1, startsAt: hours(-0.25) }), activity({ id: 2, startsAt: hours(1) })],
        NOW,
      ),
    ).toEqual({ id: 1, running: true });
  });

  it("looks ahead when the started one is further away than the next", () => {
    expect(
      closestActivity(
        [activity({ id: 1, startsAt: hours(-1.5) }), activity({ id: 2, startsAt: hours(0.25) })],
        NOW,
      ),
    ).toEqual({ id: 2, running: false });
  });

  it("ignores activities that started long ago", () => {
    expect(closestActivity([activity({ id: 1, startsAt: hours(-5) })], NOW)).toBeNull();
  });

  it("ignores unparseable start times", () => {
    expect(
      closestActivity(
        [activity({ id: 1, startsAt: "not a date" }), activity({ id: 2, startsAt: hours(2) })],
        NOW,
      ),
    ).toEqual({ id: 2, running: false });
  });
});

describe("sameActivities", () => {
  it("treats equal contents as unchanged", () => {
    expect(
      sameActivities(
        [activity({ id: 1, startsAt: hours(1) })],
        [activity({ id: 1, startsAt: hours(1) })],
      ),
    ).toBe(true);
  });

  it("spots a renamed, re-timed, or reordered list", () => {
    expect(sameActivities([activity({ id: 1 })], [activity({ id: 1, name: "Renamed" })])).toBe(
      false,
    );
    expect(sameActivities([activity({ id: 1 })], [activity({ id: 1, startsAt: hours(1) })])).toBe(
      false,
    );
    expect(
      sameActivities(
        [activity({ id: 1 }), activity({ id: 2 })],
        [activity({ id: 2 }), activity({ id: 1 })],
      ),
    ).toBe(false);
    expect(sameActivities([activity({ id: 1 })], [])).toBe(false);
  });
});
