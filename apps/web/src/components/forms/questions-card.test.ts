import { describe, expect, it } from "vitest";
import { newField, serializeApplicationField } from "@/components/forms/questions-card";

describe("application question serialization", () => {
  it("keeps video presentation on arbitrary project text questions only", () => {
    const field = {
      key: "our_film",
      label: { en: "Film", es: "Vídeo", gl: "Vídeo" },
      kind: "text" as const,
      required: false,
      project_video: true,
    };
    expect(serializeApplicationField(field)).toMatchObject({
      key: "our_film",
      project_video: true,
    });
    expect(serializeApplicationField({ ...field, kind: "textarea" })).not.toHaveProperty(
      "project_video",
    );
  });
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

  it("keeps the profile CV flag on file questions only", () => {
    const base = {
      key: "cv",
      label: { en: "CV", es: "CV", gl: "CV" },
      required: false,
      profile_cv: true,
    };
    expect(serializeApplicationField({ ...base, kind: "file" })).toMatchObject({
      profile_cv: true,
    });
    expect(serializeApplicationField({ ...base, kind: "text" })).not.toHaveProperty("profile_cv");
  });
});
