import { describe, expect, it } from "vitest";
import { serializeApplicationField } from "./questions-card";

describe("application question serialization", () => {
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
