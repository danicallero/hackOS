import { describe, expect, it } from "vitest";
import { secondsLabel } from "./helpers";

describe("judging helpers", () => {
  it("formats the presentation clock, including past the limit", () => {
    expect(secondsLabel(0)).toBe("00:00");
    expect(secondsLabel(65)).toBe("01:05");
    expect(secondsLabel(600)).toBe("10:00");
    expect(secondsLabel(3600)).toBe("60:00"); // counts in minutes, never rolls to hours

    // Over time is shown as a negative remaining, so the sign sits outside the
    // padding rather than eating a digit ("-01:05", not "0-1:05").
    expect(secondsLabel(-65)).toBe("-01:05");
    expect(secondsLabel(-5)).toBe("-00:05");

    // Fractional seconds truncate toward zero rather than rendering "01:05.4".
    expect(secondsLabel(65.9)).toBe("01:05");

    expect(secondsLabel(null)).toBe("—");
    expect(secondsLabel(undefined)).toBe("—");
  });
});
