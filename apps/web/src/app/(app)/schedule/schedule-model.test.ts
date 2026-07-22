import { describe, expect, it } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { scheduleStatus } from "./schedule-model";

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
});
