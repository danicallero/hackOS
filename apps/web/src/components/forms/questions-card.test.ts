import { describe, expect, it } from "vitest";
import { newField } from "@/components/forms/questions-card";

describe("newField", () => {
  it("creates the selected choice field ready for its first option", () => {
    expect(newField(2, "select")).toMatchObject({
      key: "field_3",
      kind: "select",
      required: false,
      options: [{ value: "", label: { en: "", es: "", gl: "" } }],
    });
  });
});
