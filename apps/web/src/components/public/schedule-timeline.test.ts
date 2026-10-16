import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { positionDayItems } from "./schedule-timeline";

const start = Date.parse("2026-10-16T08:00:00Z");
const project = (id: number, from: number, to: number) =>
  ({
    id,
    title: "Activity",
    startsAt: new Date(start + from * 60000).toISOString(),
    endsAt: new Date(start + to * 60000).toISOString(),
  }) as PublicScheduleItem;
const toY = (instant: number) => (instant - start) / 60000;
describe("calendar activity lanes (H47)", () => {
  it("gives concurrent activities separate lanes and reuses a lane at an exact handoff", () => {
    const entries = positionDayItems(
      [project(1, 0, 60), project(2, 0, 30), project(3, 30, 60)],
      toY,
    );
    expect(entries.map(({ lane, laneCount }) => [lane, laneCount])).toEqual([
      [0, 2],
      [1, 2],
      [1, 2],
    ]);
  });
  it("does not narrow later activities because an earlier group had more overlap", () => {
    const entries = positionDayItems(
      [project(1, 0, 30), project(2, 0, 30), project(3, 60, 90)],
      toY,
    );
    expect(entries.at(-1)).toMatchObject({ lane: 0, laneCount: 1, top: 60 });
  });
  it("expands into free lanes alongside a long session without covering simultaneous items", () => {
    const entries = positionDayItems(
      [project(1, 0, 600), project(2, 0, 60), project(3, 0, 60), project(4, 120, 180)],
      toY,
    );
    expect(entries.find((entry) => entry.item.id === 4)).toMatchObject({
      lane: 1,
      laneCount: 3,
      laneSpan: 2,
    });
    expect(entries.find((entry) => entry.item.id === 2)).toMatchObject({ laneSpan: 1 });
  });
  it("keeps a short activity inside its actual interval instead of expanding it over the following item", () => {
    const entries = positionDayItems([project(1, 0, 30), project(2, 30, 60)], toY);
    expect(entries[0].top + entries[0].height).toBeLessThanOrEqual(entries[1].top);
  });
});
