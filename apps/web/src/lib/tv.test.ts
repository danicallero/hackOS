import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@/components/public/public-types";
import {
  bestSponsorColumns,
  DEFAULT_LIVE_CONFIG,
  liveConfigFrom,
  msUntilNextRotation,
  resolveTimer,
  rotationIndexAt,
  type TvSlotItem,
  upcomingWindow,
  wifiJoinCode,
} from "./tv";

/** TV display logic (H41/H42) — the parts a projector can't be unit-tested on. */

const item = (mode: TvSlotItem["mode"], seconds: number | null = null): TvSlotItem => ({
  mode,
  payload: null,
  seconds,
});

describe("liveConfigFrom", () => {
  it("falls back to defaults for a missing or malformed payload", () => {
    expect(liveConfigFrom(null)).toEqual(DEFAULT_LIVE_CONFIG);
    expect(liveConfigFrom("nonsense")).toEqual(DEFAULT_LIVE_CONFIG);
    // A half-written payload keeps every block it didn't mention.
    expect(liveConfigFrom({ sponsors: { show: false } })).toEqual({
      ...DEFAULT_LIVE_CONFIG,
      sponsors: { show: false },
    });
  });

  it("keeps recognised values and drops unusable ones", () => {
    const config = liveConfigFrom({
      timer: { show: true, target: "hackingEndsAt", label: "  ", endsAt: "2026-03-01T10:00:00Z" },
      schedule: { show: true, upcoming: 3 },
      wifi: { show: true, showPassword: false },
    });
    expect(config.timer.target).toBe("hackingEndsAt");
    // Whitespace-only labels read as "no label", not as an empty heading.
    expect(config.timer.label).toBeNull();
    expect(config.schedule.upcoming).toBe(3);
    expect(config.wifi.showPassword).toBe(false);

    // An unknown target can't be honoured, so the countdown keeps working.
    expect(liveConfigFrom({ timer: { target: "whenever" } }).timer.target).toBe("auto");
    expect(liveConfigFrom({ schedule: { upcoming: 0 } }).schedule.upcoming).toBe(
      DEFAULT_LIVE_CONFIG.schedule.upcoming,
    );
    expect(liveConfigFrom({ schedule: { upcoming: 500 } }).schedule.upcoming).toBe(20);
  });
});

describe("resolveTimer", () => {
  const event = {
    hackingStartsAt: "2026-03-01T09:00:00Z",
    hackingEndsAt: "2026-03-02T09:00:00Z",
    judgingStartsAt: null,
    judgingEndsAt: null,
  } as PublicEvent;

  it("defers to the phase logic on auto", () => {
    expect(resolveTimer(DEFAULT_LIVE_CONFIG, event)).toEqual({ kind: "phase" });
  });

  it("counts to a configured event date", () => {
    const config = liveConfigFrom({ timer: { target: "hackingEndsAt", label: "Fin del hackeo" } });
    expect(resolveTimer(config, event)).toEqual({
      kind: "fixed",
      endsAt: "2026-03-02T09:00:00Z",
      label: "Fin del hackeo",
    });
  });

  it("counts to a custom datetime", () => {
    const config = liveConfigFrom({
      timer: { target: "custom", endsAt: "2026-03-01T18:00:00Z", label: "Entrega" },
    });
    expect(resolveTimer(config, event)).toMatchObject({
      kind: "fixed",
      endsAt: "2026-03-01T18:00:00Z",
    });
  });

  it("falls back to the phase logic when the chosen date is not set", () => {
    // Judging window never filled in, or a custom timer with no datetime:
    // better the live phase than a frozen "--:--:--" on the wall.
    expect(resolveTimer(liveConfigFrom({ timer: { target: "judgingEndsAt" } }), event)).toEqual({
      kind: "phase",
    });
    expect(resolveTimer(liveConfigFrom({ timer: { target: "custom" } }), event)).toEqual({
      kind: "phase",
    });
    expect(resolveTimer(liveConfigFrom({ timer: { target: "hackingEndsAt" } }), null)).toEqual({
      kind: "phase",
    });
  });
});

describe("rotationIndexAt", () => {
  const items = [item("live", 60), item("sponsors", 20)];

  it("stays put for a slot with a single item", () => {
    expect(rotationIndexAt([item("live")], 999_999)).toBe(0);
    expect(rotationIndexAt([], 10)).toBe(0);
  });

  it("advances at each dwell boundary and wraps", () => {
    expect(rotationIndexAt(items, 0)).toBe(0);
    expect(rotationIndexAt(items, 59_999)).toBe(0);
    expect(rotationIndexAt(items, 60_000)).toBe(1);
    expect(rotationIndexAt(items, 79_999)).toBe(1);
    // 80s is a full cycle: back to the first entry.
    expect(rotationIndexAt(items, 80_000)).toBe(0);
    expect(rotationIndexAt(items, 140_000)).toBe(1);
  });

  it("holds the first entry for a screen switched on before the slot starts", () => {
    expect(rotationIndexAt(items, -5_000)).toBe(0);
  });

  it("uses the default dwell when a slot item has none", () => {
    const untimed = [item("live"), item("sponsors")];
    expect(rotationIndexAt(untimed, 29_000)).toBe(0);
    expect(rotationIndexAt(untimed, 31_000)).toBe(1);
  });
});

describe("msUntilNextRotation", () => {
  const items = [item("live", 60), item("sponsors", 20)];

  it("never schedules a flip for a static slot", () => {
    expect(msUntilNextRotation([item("live")], 1000)).toBe(Number.POSITIVE_INFINITY);
  });

  it("reports the time left on the current entry", () => {
    expect(msUntilNextRotation(items, 0)).toBe(60_000);
    expect(msUntilNextRotation(items, 59_000)).toBe(1_000);
    expect(msUntilNextRotation(items, 60_000)).toBe(20_000);
    // Wrapped into the next cycle.
    expect(msUntilNextRotation(items, 80_000)).toBe(60_000);
  });

  it("waits for the slot to start when it hasn't yet", () => {
    expect(msUntilNextRotation(items, -5_000)).toBe(5_000);
  });
});

describe("upcomingWindow", () => {
  const activity = (id: number, startHour: number, endHour: number) => ({
    id,
    startsAt: `2026-03-01T${String(startHour).padStart(2, "0")}:00:00Z`,
    endsAt: `2026-03-01T${String(endHour).padStart(2, "0")}:00:00Z`,
  });
  const day = [activity(1, 9, 10), activity(2, 11, 12), activity(3, 13, 14), activity(4, 15, 16)];
  const at = (hour: number) =>
    new Date(`2026-03-01T${String(hour).padStart(2, "0")}:30:00Z`).getTime();

  it("parks on the first activity that hasn't finished", () => {
    // 11:30 — activity 2 is running, so it stays in view rather than scrolling off.
    const window = upcomingWindow(day, at(11), 2);
    expect(window.startIndex).toBe(1);
    expect(window.firstUpcomingIndex).toBe(1);
  });

  it("sits at the start of the day before anything has happened", () => {
    expect(upcomingWindow(day, at(7), 2).startIndex).toBe(0);
  });

  it("keeps the block full at the end of the day instead of showing blank rows", () => {
    // 15:30 — only activity 4 is left, but two rows still fit, so the block
    // scrolls no further than the last full page.
    const window = upcomingWindow(day, at(15), 2);
    expect(window.startIndex).toBe(2);
    expect(window.firstUpcomingIndex).toBe(3);
  });

  it("holds on the tail once everything is over", () => {
    const window = upcomingWindow(day, at(23), 2);
    expect(window.startIndex).toBe(2);
    expect(window.firstUpcomingIndex).toBe(-1);
  });

  it("sorts unordered input and copes with an empty agenda", () => {
    const shuffled = [day[2], day[0], day[3], day[1]];
    expect(upcomingWindow(shuffled, at(7), 3).ordered.map((i) => i.id)).toEqual([1, 2, 3, 4]);
    expect(upcomingWindow([], at(9), 3)).toEqual({
      ordered: [],
      startIndex: 0,
      firstUpcomingIndex: -1,
    });
  });
});

describe("bestSponsorColumns", () => {
  const grid = (over: Partial<Parameters<typeof bestSponsorColumns>[0]> = {}) =>
    bestSponsorColumns({ count: 6, width: 1200, height: 700, gap: 12, maxColumns: 6, ...over });

  it("takes the fewest columns whose rows still fit — the biggest logos", () => {
    // 6 logos in a wide, shallow block: 2 columns would need 3 rows of
    // ~400px-tall tiles (1200 tall) and overflow, so it steps up until they fit.
    expect(grid({ width: 1200, height: 700 })).toBe(3);
    // Same six logos with room to breathe: two big columns.
    expect(grid({ width: 1200, height: 1400 })).toBe(2);
  });

  it("never drops to a single column, even for one sponsor", () => {
    expect(grid({ count: 1 })).toBe(2);
    expect(grid({ count: 2, width: 400, height: 2000 })).toBe(2);
  });

  it("never uses more columns than there are sponsors", () => {
    expect(grid({ count: 3, width: 2000, height: 100 })).toBe(3);
  });

  it("falls back to the cap when nothing fits, and copes with no measurement yet", () => {
    // Too little height for any arrangement: the most columns overflow least.
    expect(grid({ count: 12, width: 600, height: 50, maxColumns: 4 })).toBe(4);
    // Before the ResizeObserver has reported, render something sane.
    expect(grid({ width: 0, height: 0 })).toBe(2);
    expect(grid({ count: 0, width: 0, height: 0 })).toBe(2);
  });
});

describe("wifiJoinCode", () => {
  it("builds a payload a phone camera joins from", () => {
    expect(wifiJoinCode({ ssid: "hackos-guest", password: "h4ck-th3-pl4n3t" })).toBe(
      "WIFI:T:WPA;S:hackos-guest;P:h4ck-th3-pl4n3t;;",
    );
  });

  it("marks a network with no password as open", () => {
    expect(wifiJoinCode({ ssid: "hackos-open", password: null })).toBe(
      "WIFI:T:nopass;S:hackos-open;;",
    );
  });

  it("escapes the characters that would otherwise end a field early", () => {
    // A password containing ; : , " or a backslash must not truncate the
    // payload — the scan would silently join with the wrong credentials.
    expect(wifiJoinCode({ ssid: "a;b", password: 'p:a,s"s\\word' })).toBe(
      'WIFI:T:WPA;S:a\\;b;P:p\\:a\\,s\\"s\\\\word;;',
    );
  });
});
