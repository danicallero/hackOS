import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { buildTimeScale, positionDayItems } from "./schedule-timeline";

const HOUR = 3_600_000;
const DAY_START = Date.parse("2026-07-22T00:00:00.000Z");

function item(overrides: Partial<PublicScheduleItem> = {}): PublicScheduleItem {
  return {
    id: 1,
    title: "Item",
    description: null,
    location: null,
    type: null,
    startsAt: new Date(DAY_START).toISOString(),
    endsAt: new Date(DAY_START + HOUR).toISOString(),
    publishAt: null,
    audiences: ["participant"],
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
    ...overrides,
  };
}

describe("buildTimeScale", () => {
  it("renders a single long event's uninterrupted middle at a capped height, not its literal duration", () => {
    const start = DAY_START + 15.5 * HOUR;
    const end = DAY_START + 21 * HOUR;
    const items = [
      item({ startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() }),
    ];
    const rangeStart = DAY_START + 15 * HOUR;
    const rangeEnd = DAY_START + 22 * HOUR;
    const scale = buildTimeScale(items, rangeStart, rangeEnd);

    // Literal scale (72px/h) would be 7h * 72 = 504px; compression must shrink it well below that.
    expect(scale.totalHeight).toBeLessThan(300);
    // The mapping stays monotonic and exact at the item's own boundaries.
    expect(scale.toY(start)).toBeGreaterThan(scale.toY(rangeStart));
    expect(scale.toY(end)).toBeGreaterThan(scale.toY(start));
    expect(scale.toY(rangeEnd)).toBe(scale.totalHeight);
  });

  it("compresses a long empty gap between two short events but leaves the events themselves at full scale", () => {
    const items = [
      item({
        startsAt: new Date(DAY_START + 9 * HOUR).toISOString(),
        endsAt: new Date(DAY_START + 9.5 * HOUR).toISOString(),
      }),
      item({
        id: 2,
        startsAt: new Date(DAY_START + 18 * HOUR).toISOString(),
        endsAt: new Date(DAY_START + 18.5 * HOUR).toISOString(),
      }),
    ];
    const rangeStart = DAY_START + 9 * HOUR;
    const rangeEnd = DAY_START + 19 * HOUR;
    const scale = buildTimeScale(items, rangeStart, rangeEnd);

    // A 10h span compressed to well under its literal 720px.
    expect(scale.totalHeight).toBeLessThan(400);
    const positioned = positionDayItems(items, scale.toY);
    const first = positioned.find((p) => p.item.id === 1);
    const second = positioned.find((p) => p.item.id === 2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Each 30-minute item still renders near its literal half-hour height (36px), not compressed.
    expect(first?.height).toBeGreaterThanOrEqual(36 - 4);
    expect(first?.height).toBeLessThan(80);
    expect(second?.height).toBeGreaterThanOrEqual(36 - 4);
    // The gap between them dominates far less of the total than its real 8.5h share would.
    expect(second ? second.top - first!.top : 0).toBeLessThan(300);
  });

  it("keeps overlapping concurrent events at full literal fidelity", () => {
    const items = [
      item({
        startsAt: new Date(DAY_START + 10 * HOUR).toISOString(),
        endsAt: new Date(DAY_START + 11.5 * HOUR).toISOString(),
      }),
      item({
        id: 2,
        startsAt: new Date(DAY_START + 10.5 * HOUR).toISOString(),
        endsAt: new Date(DAY_START + 12 * HOUR).toISOString(),
      }),
    ];
    const rangeStart = DAY_START + 10 * HOUR;
    const rangeEnd = DAY_START + 12 * HOUR;
    const scale = buildTimeScale(items, rangeStart, rangeEnd);

    // The whole 2h overlapping window is under the compression cap, so it must render at
    // the literal 72px/h scale: 2h * 72 = 144px exactly.
    expect(scale.totalHeight).toBeCloseTo(144, 5);
    const positioned = positionDayItems(items, scale.toY);
    const first = positioned.find((p) => p.item.id === 1)!;
    const second = positioned.find((p) => p.item.id === 2)!;
    // Genuinely overlapping in time, so they must land in different lanes.
    expect(first.lane).not.toBe(second.lane);
    expect(first.laneCount).toBeGreaterThanOrEqual(2);
  });
});
