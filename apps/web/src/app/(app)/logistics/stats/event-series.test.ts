import { describe, expect, it } from "vitest";
import { hourlyFlowRows, hoursDistributionRows, hoursSummary } from "./event-series";

const labels = { accreditations: "Acc", meals: "Meals", activities: "Act" };

describe("hourlyFlowRows", () => {
  it("zero-fills every series over the sorted union of hours", () => {
    const rows = hourlyFlowRows(
      {
        accreditations: [{ bucket: "2026-10-09T09:00:00.000Z", n: 4 }],
        meals: [{ bucket: "2026-10-09T08:00:00.000Z", n: 2 }],
        activities: [],
      },
      labels,
      (bucket) => bucket.slice(11, 13),
    );
    expect(rows).toEqual([
      { label: "08", n: 0, series: "Acc" },
      { label: "09", n: 4, series: "Acc" },
      { label: "08", n: 2, series: "Meals" },
      { label: "09", n: 0, series: "Meals" },
    ]);
  });

  it("returns nothing without data", () => {
    expect(hourlyFlowRows(undefined, labels, String)).toEqual([]);
  });
});

describe("hours helpers", () => {
  const hours = [
    { userId: 1, hours: 0 },
    { userId: 2, hours: 1.5 },
    { userId: 3, hours: 6 },
    { userId: 4, hours: 30 },
  ];

  it("buckets attended people by hours present", () => {
    expect(hoursDistributionRows(hours).map((row) => row.n)).toEqual([1, 0, 1, 0, 1]);
  });

  it("summarises attended people only", () => {
    expect(hoursSummary(hours)).toEqual({
      attended: 3,
      totalHours: 37.5,
      averageHours: 12.5,
    });
    expect(hoursSummary([]).averageHours).toBeNull();
  });
});
