import { describe, expect, it } from "vitest";
import { descriptionPayload } from "@/app/(app)/enterprises/enterprise-form-fields";
import { companyDescription } from "./company";

describe("company description (H44)", () => {
  it("prefers the viewer's language and falls back to the plain text", () => {
    const company = {
      description: "We build",
      descriptionTranslations: { en: "We build", gl: "Facemos" },
    };
    expect(companyDescription(company, "gl")).toBe("Facemos");
    expect(companyDescription(company, "es")).toBe("We build");
    expect(companyDescription({ description: null }, "es")).toBeNull();
  });

  it("sends translations defaulting to English, or clears both when all are empty", () => {
    expect(descriptionPayload({ en: " Hi ", es: "", gl: "Ola" })).toEqual({
      descriptionI18n: { en: "Hi", es: "Hi", gl: "Ola" },
    });
    expect(descriptionPayload({ en: "", es: " ", gl: "" })).toEqual({
      description: null,
      descriptionI18n: null,
    });
  });
});
