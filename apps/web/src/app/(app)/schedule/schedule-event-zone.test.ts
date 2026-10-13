import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromDatetimeLocal, getTimeZoneLabel, toDatetimeLocal } from "@/lib/datetime";
import { setEventTimeZone } from "@/lib/event-time";
import type { Translate } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import { scheduleExportValue } from "./schedule-export";
import {
  draftWindowBetween,
  scheduleDayKey,
  scheduleTimeOfDay,
  timeInputValue,
  withDate,
  withTimeOfDay,
  withTimeOfDayAcrossMidnight,
} from "./schedule-model";

// H45/H47/H48/H59: the roster, its inputs and its CSV read the EVENT's clock
// (Europe/Madrid here), whatever zone the browser (process TZ) is in. Run
// under several TZ values: `TZ=America/Los_Angeles vitest run`.

const t = ((key: string) => key) as Translate;

beforeEach(() => setEventTimeZone("Europe/Madrid"));
afterEach(() => setEventTimeZone(null));

describe("event-zone datetime inputs", () => {
  it("shows an instant as the event's wall clock and parses it back", () => {
    expect(toDatetimeLocal("2026-07-10T08:00:00.000Z")).toBe("2026-07-10T10:00");
    expect(fromDatetimeLocal("2026-07-10T10:00")).toBe("2026-07-10T08:00:00.000Z");
    expect(toDatetimeLocal("2026-01-10T09:00:00.000Z")).toBe("2026-01-10T10:00");
  });

  it("is DST safe on the March and October transitions", () => {
    expect(fromDatetimeLocal("2026-03-29T03:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(toDatetimeLocal("2026-03-29T01:30:00.000Z")).toBe("2026-03-29T03:30");
    expect(fromDatetimeLocal("2026-10-25T02:30")).toBe("2026-10-25T00:30:00.000Z");
    expect(fromDatetimeLocal("2026-10-25T03:30")).toBe("2026-10-25T02:30:00.000Z");
  });

  it("labels the zone with its offset", () => {
    expect(getTimeZoneLabel()).toMatch(/^Europe\/Madrid \(UTC\+[12]\)$/);
  });
});

describe("event-zone schedule model", () => {
  it("groups by the event's calendar day, not the browser's", () => {
    // 23:30 Madrid on the 10th is 21:30 UTC; 00:30 Madrid on the 11th is 22:30 UTC.
    expect(scheduleDayKey("2026-07-10T21:30:00.000Z")).toBe("2026-07-10");
    expect(scheduleDayKey("2026-07-10T22:30:00.000Z")).toBe("2026-07-11");
  });

  it("reads and sets time of day in the event zone", () => {
    expect(timeInputValue("2026-07-10T08:00:00.000Z")).toBe("10:00");
    expect(scheduleTimeOfDay("2026-07-10T08:00:00.000Z", "en")).toBe("10:00");
    expect(withTimeOfDay("2026-07-10T08:00:00.000Z", "18:15")).toBe("2026-07-10T16:15:00.000Z");
  });

  it("moves an item to another day keeping its event-zone time", () => {
    expect(withDate("2026-07-10T08:00:00.000Z", "2026-10-26")).toBe("2026-10-26T09:00:00.000Z");
    // Across the October change the UTC time shifts, the wall clock does not.
    expect(withDate("2026-10-24T08:00:00.000Z", "2026-10-25")).toBe("2026-10-25T09:00:00.000Z");
  });

  it("rolls an inverted window by a wall-clock day across the October change", () => {
    // 22:00-23:00 Madrid on 25 Oct (CET); end retyped as 01:00 inverts it.
    const res = withTimeOfDayAcrossMidnight(
      "2026-10-25T21:00:00.000Z",
      "2026-10-25T22:00:00.000Z",
      "endsAt",
      "01:00",
    );
    expect(res).toMatchObject({ ok: true, rolledToNextDay: true });
    // 01:00 on 26 Oct is CET: 00:00Z. A naive +24h from 01:00 CEST would give 23:00 wall.
    if (res.ok) expect(res.endsAt).toBe("2026-10-26T00:00:00.000Z");
  });

  it("starts an empty day at 09:00 event time", () => {
    expect(draftWindowBetween(null, null, "2026-07-10")).toEqual({
      startsAt: "2026-07-10T07:00:00.000Z",
      endsAt: "2026-07-10T07:30:00.000Z",
    });
  });
});

describe("event-zone CSV export", () => {
  const item = {
    id: 1,
    title: "Workshop",
    description: null,
    location: null,
    type: "workshop",
    requiresScan: false,
    startsAt: "2026-07-10T08:00:00.000Z",
    endsAt: "2026-07-10T09:30:00.000Z",
    visibility: "shown",
    publishAt: null,
    audiences: [],
    primaryLanguage: "es",
    titleI18n: {},
    descriptionI18n: {},
  } as PublicScheduleItem;

  it("defaults to the event zone when no zone is passed", () => {
    const ctx = { t, language: "en" as const };
    expect(scheduleExportValue(item, "starts", ctx)).toBe("10/07/2026, 10:00");
    expect(scheduleExportValue(item, "ends", ctx)).toBe("10/07/2026, 11:30");
  });
});
