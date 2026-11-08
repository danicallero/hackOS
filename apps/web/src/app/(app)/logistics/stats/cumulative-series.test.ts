import { describe, expect, it } from "vitest";
import { cumulativeDailyRows } from "./cumulative-series";

describe("cumulative application series (H27)", () => {
  it("sorts days, fills gaps, and preserves daily increments across years", () => {
    expect(
      cumulativeDailyRows(
        [
          { bucket: "2027-01-02", n: 3 },
          { bucket: "2026-12-31", n: 5 },
        ],
        (day) => day,
      ),
    ).toEqual([
      { label: "2026-12-31", n: 5, daily: 5 },
      { label: "2027-01-01", n: 5, daily: 0 },
      { label: "2027-01-02", n: 8, daily: 3 },
    ]);
  });
  it("keeps empty confirmations empty", () => {
    expect(cumulativeDailyRows([], (day) => day)).toEqual([]);
  });
});
