import { describe, expect, it } from "vitest";
import {
  mergeConfiguredStatisticsBuckets,
  resolveStatisticsPanelAccess,
  resolveStatisticsPanelDecisions,
  statisticsPanelKeys,
} from "../../src/modules/applications/stats.js";

describe("dynamic application statistics panels", () => {
  it("keeps base panels and only exposes explicitly published fields", () => {
    expect([
      ...statisticsPanelKeys([
        { key: "gender", kind: "select" },
        { key: "bio", kind: "textarea" },
        { key: "notes", kind: "text", reporting: true },
        { key: "Secret", kind: "select" },
        { key: "age", kind: "date", statistics: { enabled: true } },
      ]),
    ]).toEqual(
      expect.arrayContaining([
        "overview",
        "shirt-sizes",
        "food-intolerances",
        "field:notes",
        "field:age",
      ]),
    );
    expect(statisticsPanelKeys([{ key: "bio", kind: "textarea" }]).has("field:bio")).toBe(false);
    expect(statisticsPanelKeys([{ key: "Secret", kind: "select" }]).has("field:secret")).toBe(
      false,
    );
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

  it("returns the winning explicit panel state for a general-access fallback", () => {
    expect(
      resolveStatisticsPanelDecisions([
        { panelKey: "overview", rolePosition: 100, state: "allow" },
        { panelKey: "overview", rolePosition: 200, state: "deny" },
        { panelKey: "funnel", rolePosition: 100, state: "inherit" },
      ]),
    ).toEqual(new Map([["overview", "deny"]]));
  });

  it("lets a deny win conflicting legacy funnel and overview rules at the same position", () => {
    expect(
      resolveStatisticsPanelDecisions([
        { panelKey: "funnel", rolePosition: 100, state: "allow" },
        { panelKey: "overview", rolePosition: 100, state: "deny" },
      ]),
    ).toEqual(new Map([["overview", "deny"]]));
  });

  it("preserves configured zero-value options and checkbox defaults", () => {
    expect(
      mergeConfiguredStatisticsBuckets(
        [{ value: "Male", n: 4 }],
        [{ value: "Male" }, { value: "Female" }, { value: "Other" }],
      ),
    ).toEqual([
      { value: "Male", n: 4 },
      { value: "Female", n: 0 },
      { value: "Other", n: 0 },
    ]);
    expect(mergeConfiguredStatisticsBuckets([], [], "checkbox")).toEqual([
      { value: "true", n: 0 },
      { value: "false", n: 0 },
    ]);
  });
});
