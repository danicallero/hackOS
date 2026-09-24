import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { Translate } from "@/lib/i18n";
import {
  fieldErrorsFromApi,
  validateFieldOnBlur,
  validationErrorSummary,
} from "./application-validation";

const translate: Translate = (key) => key;
const template = [
  { key: "name", label: { en: "Name", es: "Nombre", gl: "Nome" } },
  { key: "age", label: { en: "Age", es: "Edad", gl: "Idade" } },
];

describe("application validation errors", () => {
  it("rejects implausible birth years on blur before submission", () => {
    const field = {
      key: "birthYear",
      kind: "birth_year",
      required: true,
      label: { en: "Birth year", es: "Año de nacimiento", gl: "Ano de nacemento" },
    };

    expect(validateFieldOnBlur(field, 204324523, translate, "en")).toBe("fieldMustBeBirthYear");
    expect(validateFieldOnBlur(field, new Date().getFullYear() - 121, translate, "en")).toBe(
      "fieldMustBeBirthYear",
    );
    expect(validateFieldOnBlur(field, new Date().getFullYear() - 20, translate, "en")).toBeNull();
  });

  it("localizes API field errors and formats their labels for a toast", () => {
    const error = new ApiError(400, "validation_error", "Response fails template validation", {
      fields: { name: "required", age: "must be a number", consent: "must be a boolean" },
    });
    const errors = fieldErrorsFromApi(error, translate, template, "en");

    expect(errors).toEqual({
      name: "fieldRequired",
      age: "fieldMustBeNumber",
      consent: "fieldMustBeBoolean",
    });
    expect(validationErrorSummary(errors, template, "en")).toBe(
      "Name: fieldRequired\nAge: fieldMustBeNumber\nconsent: fieldMustBeBoolean",
    );
  });

  it("uses the semantic default for URL validation failures", () => {
    const urlField = {
      key: "portfolio",
      kind: "text",
      label: { en: "Portfolio", es: "Portfolio", gl: "Portfolio" },
      validation: { text_condition: "url" },
    };
    const error = new ApiError(400, "validation_error", "Invalid response", {
      fields: { portfolio: "invalid format" },
    });

    expect(fieldErrorsFromApi(error, translate, [urlField], "en")).toEqual({
      portfolio: "invalidUrl",
    });
    expect(validateFieldOnBlur(urlField, "not-a-url", translate, "en")).toBe("invalidUrl");
    expect(validateFieldOnBlur(urlField, "example.org", translate, "en")).toBeNull();
  });
});
