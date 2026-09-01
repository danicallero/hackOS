import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { Translate } from "@/lib/i18n";
import {
  fieldErrorsFromApi,
  fmtDateTime,
  formTypeLabel,
  isConfirmationExpiredError,
  missingRequiredFields,
  statusLabel,
  type TemplateField,
} from "./lib";

const translate: Translate = (key) => key;

describe("participant application presentation", () => {
  it("does not expose an unknown API status as user-facing copy", () => {
    expect(statusLabel("accepted_internal", translate)).toBe("unknownStatus");
  });

  it("localizes a form's granted badge category instead of exposing enum values (H8)", () => {
    expect(formTypeLabel("participant", translate)).toBe("roleParticipant");
    expect(formTypeLabel("mentor", translate)).toBe("roleMentor");
    expect(formTypeLabel(null, translate)).toBe("roleUnassigned");
    expect(formTypeLabel("future_category", translate)).toBe("roleUnassigned");
  });

  it("formats dates using the selected locale", () => {
    const english = fmtDateTime("2026-07-17T10:00:00.000Z", "en");
    const spanish = fmtDateTime("2026-07-17T10:00:00.000Z", "es");

    expect(english).toContain("2026");
    expect(spanish).toContain("2026");
    expect(english).not.toBe(spanish);
  });

  it("maps API field validation to localized field messages", () => {
    const error = new ApiError(400, "validation_error", "Invalid response", {
      fields: { name: "required", age: "must be a number", link: "other" },
    });
    expect(fieldErrorsFromApi(error, translate)).toEqual({
      name: "fieldRequired",
      age: "fieldMustBeNumber",
      link: "fieldInvalid",
    });
  });

  it("recognizes an expired confirmation response", () => {
    expect(
      isConfirmationExpiredError(
        new ApiError(409, "conflict", "Expired", { code: "confirmation_expired" }),
      ),
    ).toBe(true);
  });
});

describe("missingRequiredFields", () => {
  const template: TemplateField[] = [
    { key: "name", label: { en: "Name", es: "Nombre", gl: "Nome" }, kind: "text", required: true },
    { key: "bio", label: { en: "Bio", es: "Bio", gl: "Bio" }, kind: "textarea", required: false },
    {
      key: "agree",
      label: { en: "Agree", es: "De acuerdo", gl: "De acordo" },
      kind: "checkbox",
      required: true,
    },
    {
      key: "topics",
      label: { en: "Topics", es: "Temas", gl: "Temas" },
      kind: "multiselect",
      required: true,
    },
  ];

  it("flags required fields left empty, blank, or unchecked", () => {
    expect(missingRequiredFields(template, { name: "  ", agree: false, topics: [] })).toEqual([
      "name",
      "agree",
      "topics",
    ]);
  });

  it("ignores optional fields regardless of value", () => {
    expect(missingRequiredFields(template, { name: "Ada", agree: true, topics: ["a"] })).toEqual(
      [],
    );
  });

  it("only accepts a checkbox as satisfied when strictly true", () => {
    expect(
      missingRequiredFields(
        [{ key: "agree", label: { en: "", es: "", gl: "" }, kind: "checkbox", required: true }],
        { agree: "true" },
      ),
    ).toEqual(["agree"]);
  });
});
