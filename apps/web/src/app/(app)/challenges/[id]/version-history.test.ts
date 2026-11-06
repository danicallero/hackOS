import { describe, expect, it } from "vitest";
import { changedFields, fieldValueForDisplay, type VersionSnapshot } from "./version-history";

function snapshot(overrides: Partial<VersionSnapshot> = {}): VersionSnapshot {
  return {
    title: "Challenge",
    description: "A description",
    criteria: "Judged on impact",
    prizes: [{ name: "Best overall" }],
    judging_panel_criteria: [{ key: "impact" }],
    available_from: null,
    ...overrides,
  };
}

describe("changedFields", () => {
  it("is empty for the initial version (no previous snapshot)", () => {
    expect(changedFields(snapshot(), null)).toEqual([]);
  });

  it("names the fields that changed since the previous version", () => {
    const previous = snapshot();
    const current = snapshot({ title: "New title", prizes: [] });
    expect(changedFields(current, previous)).toEqual(["versionFieldTitle", "versionFieldPrizes"]);
  });

  it("names a scheduled-reveal change (H45 scheduled reveal shows in the history)", () => {
    const previous = snapshot({ available_from: null });
    const current = snapshot({ available_from: "2026-08-01T10:00:00.000Z" });
    expect(changedFields(current, previous)).toEqual(["versionFieldReveal"]);
  });

  it("is empty when nothing changed between two saves", () => {
    expect(changedFields(snapshot(), snapshot())).toEqual([]);
  });
});

describe("fieldValueForDisplay", () => {
  it("renders prize names, or a placeholder when there are none", () => {
    expect(
      fieldValueForDisplay("prizes", [{ name: "Best overall" }, { name: "Runner-up" }], "en"),
    ).toBe("Best overall, Runner-up");
    expect(fieldValueForDisplay("prizes", [], "en")).toBe("—");
    expect(fieldValueForDisplay("prizes", null, "en")).toBe("—");
  });

  it("renders judging criteria labels, falling back to the key", () => {
    expect(
      fieldValueForDisplay(
        "judging_panel_criteria",
        [
          { key: "impact", label: { en: "Impact", es: "Impacto", gl: "Impacto" } },
          { key: "no_label" },
        ],
        "en",
      ),
    ).toBe("Impact, no_label");
  });

  it("formats the scheduled reveal date, or a placeholder when unscheduled", () => {
    expect(fieldValueForDisplay("available_from", "2026-08-01T10:00:00.000Z", "en")).toMatch(
      /^01 Aug 2026, \d{2}:\d{2}$/,
    );
    expect(fieldValueForDisplay("available_from", null, "en")).toBe("—");
  });

  it("renders plain and i18n text fields via textForDisplay", () => {
    expect(fieldValueForDisplay("title", "Challenge", "en")).toBe("Challenge");
    expect(fieldValueForDisplay("title", { en: "Challenge", es: "", gl: "" }, "en")).toBe(
      "Challenge",
    );
    expect(fieldValueForDisplay("title", "", "en")).toBe("—");
  });
});
