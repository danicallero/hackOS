/**
 * #966: the compact Live Activity countdown rule (`formatLiveCountdown`),
 * which the iOS widget renders natively (`CompactCountdownFormatStyle`,
 * `patches/@expo__ui@57.0.22.patch`) so it ticks without updates.
 */

import {
  activityLiveLabels,
  attendeeActivityLiveLabels,
  deadlineLiveLabels,
  formatLiveCountdown,
  type LiveDurationUnits,
} from "@hackos/shared/live-activities";

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const en: LiveDurationUnits = { hour: "h", minute: "m", second: "s" };

describe("formatLiveCountdown (#966)", () => {
  it.each([
    [0, "0s"],
    [59 * S, "59s"],
    [59 * S + 999, "59s"],
    [1 * M, "1m"],
    [10 * M, "10m"],
    [59 * M + 59 * S, "59m"],
    [1 * H, "1h"],
    [1 * H + 20 * M, "1h 20m"],
    [1 * H + 20 * M + 59 * S, "1h 20m"],
    [25 * H, "25h"],
    [26 * H + 5 * M, "26h 5m"],
  ])("%d ms reads %s", (ms, expected) => {
    expect(formatLiveCountdown(ms, en)).toBe(expected);
  });

  it("reads 0s once the instant has passed or is unknown", () => {
    expect(formatLiveCountdown(-5 * S, en)).toBe("0s");
    expect(formatLiveCountdown(Number.NaN, en)).toBe("0s");
  });

  it("keeps the leading unit only for the minimal view", () => {
    expect(formatLiveCountdown(1 * H + 20 * M, en, 1)).toBe("1h");
    expect(formatLiveCountdown(45 * M + 30 * S, en, 1)).toBe("45m");
    expect(formatLiveCountdown(42 * S, en, 1)).toBe("42s");
  });

  it("uses each language's pre-localized units", () => {
    expect(formatLiveCountdown(1 * H + 20 * M, activityLiveLabels("es").units!)).toBe("1h 20min");
    expect(formatLiveCountdown(10 * M, attendeeActivityLiveLabels("gl").units!)).toBe("10min");
    expect(formatLiveCountdown(30 * S, deadlineLiveLabels("en").units!)).toBe("30s");
  });

  it("fits the 7-character Android chip and compact island in English", () => {
    for (const ms of [59 * S, 59 * M, 23 * H + 59 * M, 99 * H + 59 * M]) {
      expect(formatLiveCountdown(ms, en).length).toBeLessThanOrEqual(7);
    }
  });
});
