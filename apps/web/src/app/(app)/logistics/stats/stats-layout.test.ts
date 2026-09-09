import { describe, expect, it } from "vitest";
import { defaultStatsChartType, sanitizeStatsLayout } from "./stats-layout";

describe("statistics layout", () => {
  it("drops removed panels and gives new panels sensible default sizes", () => {
    expect(
      sanitizeStatsLayout(
        {
          order: ["funnel", "shirt-sizes", "missing", "funnel"],
          hidden: ["funnel", "missing"],
          charts: { funnel: "pie", "shirt-sizes": "pie", missing: "line" },
          sections: [
            { id: "main", title: "Main", panelKeys: ["funnel", "shirt-sizes", "missing"] },
            { id: "invalid", title: 42, panelKeys: ["overview"] },
          ],
          sizes: { funnel: { width: 2, height: 2 } },
        },
        ["overview", "shirt-sizes"],
      ),
    ).toEqual({
      order: ["shirt-sizes", "overview"],
      hidden: [],
      charts: { "shirt-sizes": "pie" },
      sections: [{ id: "main", title: "Main", panelKeys: ["shirt-sizes"] }],
      sizes: {
        overview: { width: 2, height: 1 },
        "shirt-sizes": { width: 1, height: 1 },
      },
    });
  });

  it("chooses an appropriate chart default for each data shape", () => {
    expect(defaultStatsChartType("applications-over-time")).toBe("line");
    expect(defaultStatsChartType("field:consent", "checkbox")).toBe("pie");
    expect(defaultStatsChartType("shirt-sizes")).toBe("bar");
  });
});
