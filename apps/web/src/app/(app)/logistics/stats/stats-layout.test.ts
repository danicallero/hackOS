import { describe, expect, it } from "vitest";
import { defaultStatsChartType, sanitizeStatsLayout } from "./stats-layout";

describe("statistics layout", () => {
  it("keeps only available panels while preserving the personal order and groups", () => {
    expect(
      sanitizeStatsLayout(
        {
          order: ["funnel", "missing", "funnel"],
          hidden: ["funnel", "missing"],
          charts: { funnel: "pie", missing: "line", overview: "invalid" },
          sections: [
            { id: "main", title: "Main", panelKeys: ["funnel", "missing"] },
            { id: "invalid", title: 42, panelKeys: ["overview"] },
          ],
        },
        ["overview", "funnel"],
      ),
    ).toEqual({
      order: ["funnel", "overview"],
      hidden: ["funnel"],
      charts: { funnel: "pie" },
      sections: [{ id: "main", title: "Main", panelKeys: ["funnel"] }],
      sizes: {},
    });
  });

  it("chooses an appropriate chart default for each data shape", () => {
    expect(defaultStatsChartType("applications-over-time")).toBe("line");
    expect(defaultStatsChartType("field:consent", "checkbox")).toBe("pie");
    expect(defaultStatsChartType("shirt-sizes")).toBe("bar");
  });
});
