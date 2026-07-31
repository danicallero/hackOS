import { describe, expect, it } from "vitest";
import type { PresenceCertaintyWindow, PresenceTimelineSignal } from "./logistics";
import {
  conflictBounds,
  durationMinutes,
  guaranteedMinutes,
  provisionalMinutes,
  timelineRows,
} from "./presence-timeline";

const window = (overrides: Partial<PresenceCertaintyWindow> = {}): PresenceCertaintyWindow => ({
  start: "2026-07-15T08:00:00.000Z",
  deadline: "2026-07-15T20:00:00.000Z",
  securedUntil: null,
  status: "provisional",
  openedBy: "in",
  closedBy: null,
  conflict: false,
  ...overrides,
});

const signal = (
  id: number,
  kind: PresenceTimelineSignal["kind"],
  occurredAt: string,
): PresenceTimelineSignal => ({
  id,
  source: kind === "activity" ? "activity" : "door",
  kind,
  occurredAt,
  activityId: null,
  activityName: null,
  category: null,
  notes: null,
  recordedBy: null,
});

describe("web presence timeline model", () => {
  it("formats non-negative elapsed minutes and separates secured time", () => {
    expect(durationMinutes("2026-07-15T08:00:00.000Z", "2026-07-15T09:30:00.000Z")).toBe(90);
    expect(guaranteedMinutes([window({ securedUntil: "2026-07-15T10:00:00.000Z" })])).toBe(120);
    expect(provisionalMinutes([window()], Date.parse("2026-07-15T09:15:00.000Z"))).toBe(75);
  });

  it("pairs windows with the entry/activity that opened them and keeps exits visible", () => {
    const signals = [
      signal(1, "in", "2026-07-15T08:00:00.000Z"),
      signal(2, "activity", "2026-07-15T09:00:00.000Z"),
      signal(3, "out", "2026-07-15T10:00:00.000Z"),
    ];
    const rows = timelineRows(signals, [window(), window({ openedBy: "activity" })]);

    expect(rows.map(({ signal: item }) => item.id)).toEqual([3, 2, 1]);
    expect(rows[0]?.window).toBeNull();
    expect(rows[1]?.window?.openedBy).toBe("activity");
    expect(rows[2]?.window?.openedBy).toBe("in");
  });

  it("exposes strict repair bounds for a conflict gap", () => {
    const bounds = conflictBounds({
      firstLogId: 1,
      secondLogId: 2,
      from: "2026-07-15T08:00:30.000Z",
      to: "2026-07-15T09:00:30.000Z",
    });

    expect(bounds.min.toISOString()).toBe("2026-07-15T08:00:30.000Z");
    expect(bounds.max.toISOString()).toBe("2026-07-15T09:00:30.000Z");
  });
});
