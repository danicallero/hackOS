import { afterEach, describe, expect, it } from "vitest";
import {
  formatDurationMinutes,
  formatEventDate,
  formatHoursMinutes,
  fromLocalInputValue,
  toLocalInputValue,
} from "./datetime";
import { setEventTimeZone } from "./event-time";
import type { Translate } from "./i18n";

const MADRID = "Europe/Madrid";
const instant = "2026-07-10T08:30:00.000Z";

describe("formatEventDate", () => {
  afterEach(() => setEventTimeZone(MADRID));

  it("renders in the event zone, not the device zone", () => {
    setEventTimeZone("America/New_York");
    expect(formatEventDate(instant, "en", "clock24")).toBe("04:30");
    setEventTimeZone(MADRID);
    expect(formatEventDate(instant, "en", "clock24")).toBe("10:30");
  });

  it("follows the app language and accepts an explicit zone", () => {
    expect(formatEventDate(instant, "en", "dateTime", MADRID)).toBe("10 Jul 2026, 10:30");
    expect(formatEventDate(instant, "es", "weekdayDayMonth", MADRID)).toMatch(/vie/i);
  });

  it("renders the day, chart-bucket and agenda presets in the given zone", () => {
    expect(formatEventDate(instant, "en", "weekdayDayMonthText", MADRID)).toMatch(/^Fri,? 10 Jul$/);
    expect(formatEventDate(instant, "en", "weekdayDayMonthLong", MADRID)).toMatch(
      /^Friday,? 10 July$/,
    );
    expect(formatEventDate(instant, "en", "weekdayClock", "Asia/Tokyo")).toMatch(/^Fri,? 17:30$/);
    expect(formatEventDate(instant, "en", "dayMonthHour", MADRID)).toMatch(/10 Jul.*10/);
    expect(formatEventDate(instant, "en", "dateTimeLong", "UTC")).toMatch(/10 July 2026.*08:30/);
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(formatEventDate(null, "en", "date")).toBe("");
    expect(formatEventDate("nope", "en", "date")).toBe("");
  });
});

describe("durations", () => {
  it("formats h:mm and rejects non-positive spans", () => {
    expect(formatHoursMinutes(90)).toBe("1:30");
    expect(formatHoursMinutes(125)).toBe("2:05");
    expect(formatHoursMinutes(0)).toBe("");
    expect(formatHoursMinutes(Number.NaN)).toBe("");
  });

  it("picks the minutes, whole-hours or hours-and-minutes message", () => {
    const t: Translate = (key, values) => `${key}:${JSON.stringify(values)}`;
    expect(formatDurationMinutes(45, t)).toBe('presenceMinutesValue:{"minutes":45}');
    expect(formatDurationMinutes(120, t)).toBe('presenceWholeHoursValue:{"hours":2}');
    expect(formatDurationMinutes(125, t)).toBe('presenceHoursMinutesValue:{"hours":2,"minutes":5}');
  });
});

describe("datetime-local inputs", () => {
  it("round-trips a wall clock through the given zone", () => {
    const iso = fromLocalInputValue("2026-07-10T10:30", MADRID);
    expect(iso).toBe(instant);
    expect(toLocalInputValue(iso, MADRID)).toBe("2026-07-10T10:30");
    expect(fromLocalInputValue("", MADRID)).toBeNull();
  });
});
