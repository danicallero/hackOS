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
      fieldReasons: { name: "required", age: "must_be_number", consent: "must_be_boolean" },
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
      fieldReasons: { portfolio: "invalid_format" },
    });

    expect(fieldErrorsFromApi(error, translate, [urlField], "en")).toEqual({
      portfolio: "invalidUrl",
    });
    expect(validateFieldOnBlur(urlField, "not-a-url", translate, "en")).toBe("invalidUrl");
    expect(validateFieldOnBlur(urlField, "example.org", translate, "en")).toBeNull();
  });
});

describe("dynamic field validation before submit", () => {
  const base = { key: "field", label: { en: "Field", es: "Campo", gl: "Campo" } };
  it.each([
    ["phone", "123", "fieldMustBePhone"],
    ["phone", "600111222", null],
    ["phone", "+44 7911 123456", null],
    ["text", "   ", "fieldRequired"],
    ["checkbox", false, "fieldRequired"],
    ["checkbox", true, null],
    ["number", Number.NaN, "fieldMustBeNumber"],
    ["city", { city: "A Coruña", province: "", country: "ES" }, "fieldMustBeCity"],
    ["city", { city: "A Coruña", province: "A Coruña", country: "ES" }, null],
    ["library", ["TypeScript", "Rust"], null],
    ["university", "abc", "fieldMustBeUniversity"],
  ])("checks %s values on blur", (kind, value, expected) => {
    expect(
      validateFieldOnBlur({ ...base, kind: String(kind), required: true }, value, translate, "en"),
    ).toBe(expected);
  });
  it("checks configured options and constraints", () => {
    const field = {
      ...base,
      kind: "multiselect",
      options: [{ value: "one" }, { value: "two" }],
      validation: { min_selected: 2 },
    };
    expect(validateFieldOnBlur(field, ["old"], translate, "en")).toBe("fieldInvalidOption");
    expect(validateFieldOnBlur(field, ["one"], translate, "en")).toBe("tooFewSelected");
    expect(validateFieldOnBlur(field, ["one", "two"], translate, "en")).toBeNull();
    expect(
      validateFieldOnBlur(
        { ...base, kind: "number", validation: { min: 2, max: 5 } },
        1,
        translate,
        "en",
      ),
    ).toBe("tooSmall");
    expect(
      validateFieldOnBlur(
        { ...base, kind: "text", validation: { min_length: 4 } },
        "abc",
        translate,
        "en",
      ),
    ).toBe("tooShort");
    expect(
      validateFieldOnBlur(
        { ...base, kind: "text", project_video: true },
        "example.org",
        translate,
        "en",
      ),
    ).toBe("invalidUrl");
  });
});

it("combines text conditions and patterns instead of skipping a passing pattern", () => {
  const field = {
    key: "name",
    kind: "text",
    label: { en: "Name", es: "Nome", gl: "Nome" },
    validation: { text_condition: "contains", text_value: "hack", pattern: "^[a-z]+$" },
  };
  expect(validateFieldOnBlur(field, "plain", translate, "en")).toBe("mustContainText");
  expect(validateFieldOnBlur(field, "hack123", translate, "en")).toBe("invalidFormat");
  expect(validateFieldOnBlur(field, "hackos", translate, "en")).toBeNull();
});
