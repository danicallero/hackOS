import { describe, expect, it } from "vitest";
import { newField, serializeApplicationField } from "./questions-card";

describe("application question serialization", () => {
  it("creates the selected choice field ready for its first option", () => {
    expect(newField(2, "select")).toMatchObject({
      key: "field_3",
      kind: "select",
      required: false,
      options: [{ value: "", label: { en: "", es: "", gl: "" } }],
    });
  });

  it("preserves the Logistics statistics integration configuration", () => {
    expect(
      serializeApplicationField({
        key: " experience ",
        label: { en: "Experience", es: "Experiencia", gl: "Experiencia" },
        kind: "select",
        required: false,
        options: [{ value: "first", label: { en: "First", es: "Primera", gl: "Primeira" } }],
        statistics: {
          enabled: true,
          visualization: "pie",
          aggregation: "count",
          transformation: "none",
        },
      }),
    ).toMatchObject({
      key: "experience",
      statistics: {
        enabled: true,
        visualization: "pie",
        aggregation: "count",
        transformation: "none",
      },
    });
  });
});
