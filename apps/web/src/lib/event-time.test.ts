import {
  instantToWallClock,
  isValidTimeZone,
  wallClockToInstant,
  zoneAbbreviation,
  zoneOffsetMinutes,
} from "@hackos/shared/event-time";
import { describe, expect, it } from "vitest";

const MADRID = "Europe/Madrid";

describe("event-time helpers", () => {
  it("reads offsets across DST", () => {
    expect(zoneOffsetMinutes(Date.parse("2026-07-01T00:00:00Z"), MADRID)).toBe(120);
    expect(zoneOffsetMinutes(Date.parse("2026-01-01T00:00:00Z"), MADRID)).toBe(60);
  });

  it("converts wall clock to instant and back regardless of the device zone", () => {
    expect(wallClockToInstant("2026-07-10T10:00", MADRID)).toBe("2026-07-10T08:00:00.000Z");
    expect(wallClockToInstant("2026-01-10T10:00", MADRID)).toBe("2026-01-10T09:00:00.000Z");
    expect(wallClockToInstant("2026-07-10T10:00", "America/New_York")).toBe(
      "2026-07-10T14:00:00.000Z",
    );
    expect(instantToWallClock("2026-07-10T08:00:00.000Z", MADRID)).toBe("2026-07-10T10:00");
    expect(instantToWallClock("2026-07-10T08:00:30.000Z", MADRID, true)).toBe(
      "2026-07-10T10:00:30",
    );
  });

  it("handles the March spring-forward gap (02:30 does not exist)", () => {
    // 2026-03-29: 02:00 CET -> 03:00 CEST.
    expect(wallClockToInstant("2026-03-29T01:59", MADRID)).toBe("2026-03-29T00:59:00.000Z");
    expect(wallClockToInstant("2026-03-29T03:00", MADRID)).toBe("2026-03-29T01:00:00.000Z");
    expect(wallClockToInstant("2026-03-29T02:30", MADRID)).toBe("2026-03-29T01:30:00.000Z");
    expect(instantToWallClock("2026-03-29T01:30:00.000Z", MADRID)).toBe("2026-03-29T03:30");
  });

  it("resolves the October fall-back overlap to the first occurrence", () => {
    // 2026-10-25: 03:00 CEST -> 02:00 CET, so 02:30 happens twice.
    expect(wallClockToInstant("2026-10-25T02:30", MADRID)).toBe("2026-10-25T00:30:00.000Z");
    expect(instantToWallClock("2026-10-25T00:30:00.000Z", MADRID)).toBe("2026-10-25T02:30");
    expect(instantToWallClock("2026-10-25T01:30:00.000Z", MADRID)).toBe("2026-10-25T02:30");
    expect(wallClockToInstant("2026-10-25T03:30", MADRID)).toBe("2026-10-25T02:30:00.000Z");
    expect(wallClockToInstant("2026-10-25T01:59", MADRID)).toBe("2026-10-24T23:59:00.000Z");
  });

  it("round-trips every quarter hour around both transitions", () => {
    for (const day of ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25"]) {
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 15, 30, 45]) {
          const wall = `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const iso = wallClockToInstant(wall, MADRID);
          expect(iso).not.toBeNull();
          const isGap = day === "2026-03-29" && h === 2;
          if (!isGap) expect(instantToWallClock(iso, MADRID)).toBe(wall);
        }
      }
    }
  });

  it("rejects malformed and impossible values", () => {
    expect(wallClockToInstant("", MADRID)).toBeNull();
    expect(wallClockToInstant("nope", MADRID)).toBeNull();
    expect(wallClockToInstant("2026-02-31T10:00", MADRID)).toBeNull();
    expect(instantToWallClock("garbage", MADRID)).toBe("");
    expect(instantToWallClock(null, MADRID)).toBe("");
  });

  it("accepts a date-only value as midnight", () => {
    expect(wallClockToInstant("2026-07-10", MADRID)).toBe("2026-07-09T22:00:00.000Z");
  });

  it("validates zones and names them tersely", () => {
    expect(isValidTimeZone(MADRID)).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(zoneAbbreviation(MADRID, "en-GB", Date.parse("2026-07-01T00:00:00Z"))).toMatch(
      /CEST|GMT\+2/,
    );
  });
});
