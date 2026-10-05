import { describe, expect, it } from "vitest";
import { groupApplicationFields } from "./application-field-groups";

describe("application field ordering", () => {
  const sections = [{ key: "about" }, { key: "links" }];
  const fields = [
    { key: "cv" },
    { key: "motivation", section_key: "about" },
    { key: "consent", after_section_key: "about" },
    { key: "portfolio", section_key: "links" },
    { key: "notes", after_section_key: "links" },
  ];

  it("keeps standalone questions below their anchor in all form renderers", () => {
    expect(
      groupApplicationFields(fields, sections).map((group) => ({
        section: group.section?.key ?? null,
        fields: group.fields.map((field) => field.key),
      })),
    ).toEqual([
      { section: null, fields: ["cv"] },
      { section: "about", fields: ["motivation"] },
      { section: null, fields: ["consent"] },
      { section: "links", fields: ["portfolio"] },
      { section: null, fields: ["notes"] },
    ]);
  });

  it("moves anchored questions with their section without changing ownership", () => {
    expect(
      groupApplicationFields(fields, [...sections].reverse()).flatMap((group) =>
        group.fields.map((field) => field.key),
      ),
    ).toEqual(["cv", "portfolio", "notes", "motivation", "consent"]);
  });

  it("renders legacy ungrouped fields and orphaned snapshots before sections", () => {
    expect(
      groupApplicationFields([{ key: "legacy", after_section_key: "removed" }], sections),
    ).toEqual([{ section: null, fields: [{ key: "legacy", after_section_key: "removed" }] }]);
  });
});
