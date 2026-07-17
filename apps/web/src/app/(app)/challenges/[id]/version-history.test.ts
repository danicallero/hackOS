import { describe, expect, it } from "vitest";
import { changedFields, type VersionSnapshot } from "./version-history";

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
