import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/components/public/public-types";
import { defaultDataPhase, exportUrl, FRESHNESS_KINDS, normalizedFilters } from "./model";

const event: PublicEvent = {
  name: "hackOS",
  tagline: null,
  timezone: "Europe/Madrid",
  hackingStartsAt: "2026-07-18T08:00:00.000Z",
  hackingEndsAt: "2026-07-19T08:00:00.000Z",
  judgingStartsAt: "2026-07-19T09:00:00.000Z",
  judgingEndsAt: "2026-07-19T12:00:00.000Z",
  showStartCountdown: false,
};

describe("data dashboard model", () => {
  it("selects before, during, and after from the configured event window", () => {
    expect(defaultDataPhase(event, Date.parse("2026-07-17T12:00:00.000Z"))).toBe("before");
    expect(defaultDataPhase(event, Date.parse("2026-07-18T12:00:00.000Z"))).toBe("during");
    expect(defaultDataPhase(event, Date.parse("2026-07-19T12:00:00.000Z"))).toBe("after");
  });

  it("keeps every required freshness state explicit", () => {
    expect(FRESHNESS_KINDS).toEqual(["actual", "estimated", "provisional", "incomplete"]);
  });

  it("uses the same normalized filters for the view and export", () => {
    const filters = { status: "confirmed", applicationId: 7, empty: null };
    expect(normalizedFilters(filters)).toEqual({ applicationId: "7", status: "confirmed" });
    expect(exportUrl("/api/exports/applications.csv", filters)).toBe(
      "/api/exports/applications.csv?applicationId=7&status=confirmed",
    );
  });
});
