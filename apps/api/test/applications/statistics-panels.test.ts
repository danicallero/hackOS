import { describe, expect, it } from "vitest";
import {
  resolveStatisticsPanelAccess,
  statisticsPanelKeys,
} from "../../src/modules/applications/stats.js";

describe("dynamic application statistics panels", () => {
  it("keeps base panels and only exposes safe/reportable fields", () => {
    expect([
      ...statisticsPanelKeys([
        { key: "gender", kind: "select" },
        { key: "bio", kind: "textarea" },
        { key: "notes", kind: "text", reporting: true },
        { key: "Secret", kind: "text" },
      ]),
    ]).toEqual(
      expect.arrayContaining([
        "overview",
        "funnel",
        "shirt-sizes",
        "food-intolerances",
        "field:gender",
        "field:notes",
      ]),
    );
    expect(statisticsPanelKeys([{ key: "bio", kind: "textarea" }]).has("field:bio")).toBe(false);
    expect(statisticsPanelKeys([{ key: "Secret", kind: "select" }]).has("field:secret")).toBe(true);
  });

  it("applies H8 precedence and defaults to deny", () => {
    expect(
      resolveStatisticsPanelAccess([
        { panelKey: "funnel", rolePosition: 100, state: "allow" },
        { panelKey: "funnel", rolePosition: 200, state: "deny" },
        { panelKey: "shirt-sizes", rolePosition: 200, state: "inherit" },
        { panelKey: "shirt-sizes", rolePosition: 100, state: "allow" },
        { panelKey: "food-intolerances", rolePosition: 100, state: "inherit" },
      ]),
    ).toEqual(new Set(["shirt-sizes"]));
  });
});
