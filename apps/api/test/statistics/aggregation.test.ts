import { describe, expect, it } from "vitest";
import { mergeApplicationSnapshots } from "../../src/modules/statistics/service.js";

describe("statistics aggregation", () => {
  it("sums compatible scopes and weights aggregate averages", () => {
    const result = mergeApplicationSnapshots([
      {
        counts_by_status: { review: 2 },
        funnel: { sent: 2, confirmed: 1 },
        time_to_confirm_hours: { avg: 2, median: 2, count: 1 },
        time_series: { submissions_by_day: [{ bucket: "2026-03-12", n: 2 }] },
        shirt_sizes_confirmed: [{ value: "M", n: 1 }],
        food_intolerances_confirmed: [],
        field_distributions: [],
      },
      {
        counts_by_status: { review: 3 },
        funnel: { sent: 3, confirmed: 2 },
        time_to_confirm_hours: { avg: 6, median: 6, count: 3 },
        time_series: { submissions_by_day: [{ bucket: "2026-03-12", n: 3 }] },
        shirt_sizes_confirmed: [{ value: "M", n: 2 }],
        food_intolerances_confirmed: [],
        field_distributions: [],
      },
    ]);

    expect(result.overview).toMatchObject({
      submitted: 5,
      confirmed: 3,
      confirmation_rate: 0.6,
      average_confirmation_time_hours: 5,
    });
    expect(result.time_to_confirm_hours).toMatchObject({ avg: 5, median: null });
    expect(result.time_series).toEqual({
      submissions_by_day: [{ bucket: "2026-03-12", n: 5 }],
    });
    expect(result.shirt_sizes_confirmed).toEqual([{ value: "M", n: 3 }]);
  });
});
