import { sponsorShareKey } from "@hackos/shared/applications";
import { FIELD_ERROR_REASONS } from "@hackos/shared/error-reasons";
import { isSimpleEmail, isSimpleUrl, MAX_IMAGES_PER_FIELD } from "@hackos/shared/forms";
import { normalizePhone } from "@hackos/shared/phone";
import type { TemplateField } from "../modules/applications/schemas.js";
import { BadRequestError } from "./errors.js";

/**
 * Form-answer validation (H11, H12, H19, H56), shared by applications and
 * projects. Pure: no database, workflow or worker imports, so any domain can
 * validate against a form template without loading another domain's service.
 */

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Birth years describe living applicants; keep the accepted age range realistic. */
const MAXIMUM_BIRTH_AGE = 120;

function minimumBirthYear(now = new Date()): number {
  return now.getFullYear() - MAXIMUM_BIRTH_AGE;
}

// Legacy `details.fields` messages → stable `details.fieldReasons` (#996).
const FIELD_ERROR_REASON_BY_MESSAGE: Record<string, string> = {
  required: FIELD_ERROR_REASONS.REQUIRED,
  "invalid option": FIELD_ERROR_REASONS.INVALID_OPTION,
  "must be a number": FIELD_ERROR_REASONS.MUST_BE_NUMBER,
  "must be a birth year": FIELD_ERROR_REASONS.MUST_BE_BIRTH_YEAR,
  "too young": FIELD_ERROR_REASONS.BIRTH_YEAR_TOO_RECENT,
  "must be a phone number": FIELD_ERROR_REASONS.MUST_BE_PHONE,
  "must be a boolean": FIELD_ERROR_REASONS.MUST_BE_BOOLEAN,
  "must be an array": FIELD_ERROR_REASONS.MUST_BE_ARRAY,
  "must be a string": FIELD_ERROR_REASONS.MUST_BE_STRING,
  "must be a university id": FIELD_ERROR_REASONS.MUST_BE_UNIVERSITY_ID,
  "must be a degree id": FIELD_ERROR_REASONS.MUST_BE_DEGREE_ID,
  "must include city, province, and country": FIELD_ERROR_REASONS.MUST_BE_CITY,
  "too short": FIELD_ERROR_REASONS.TOO_SHORT,
  "too long": FIELD_ERROR_REASONS.TOO_LONG,
  "invalid format": FIELD_ERROR_REASONS.INVALID_FORMAT,
  "too small": FIELD_ERROR_REASONS.TOO_SMALL,
  "too large": FIELD_ERROR_REASONS.TOO_LARGE,
  "too few selected": FIELD_ERROR_REASONS.TOO_FEW_SELECTED,
  "too many selected": FIELD_ERROR_REASONS.TOO_MANY_SELECTED,
  "must contain text": FIELD_ERROR_REASONS.MUST_CONTAIN_TEXT,
  "must not contain text": FIELD_ERROR_REASONS.MUST_NOT_CONTAIN_TEXT,
  "invalid email": FIELD_ERROR_REASONS.INVALID_EMAIL,
  "invalid url": FIELD_ERROR_REASONS.INVALID_URL,
};

/**
 * Builder-defined validation rules (H11) on top of the kind-shape check —
 * length/pattern for text, min/max for number, selection count for
 * multiselect. `field.validation`'s sub-fields not relevant to `field.kind`
 * are ignored rather than erroring, so switching kind mid-edit is harmless.
 * Only called once the value has already passed its kind-shape check, so the
 * type narrowing below (string/number/array) is safe.
 */
function checkFieldValidation(field: TemplateField, value: unknown): string | null {
  const v = field.validation;
  if (!v) return null;
  if ((field.kind === "text" || field.kind === "textarea") && typeof value === "string") {
    if (v.min_length !== undefined && value.length < v.min_length) return "too short";
    if (v.max_length !== undefined && value.length > v.max_length) return "too long";
    if (v.text_condition === "contains" && v.text_value && !value.includes(v.text_value)) {
      return "must contain text";
    }
    if (v.text_condition === "not_contains" && v.text_value && value.includes(v.text_value)) {
      return "must not contain text";
    }
    if (v.text_condition === "email" && !isSimpleEmail(value)) return "invalid email";
    if (v.text_condition === "url" && !isSimpleUrl(value)) return "invalid url";
    if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) return "invalid format";
  }
  if (field.kind === "number" && typeof value === "number") {
    if (v.min !== undefined && value < v.min) return "too small";
    if (v.max !== undefined && value > v.max) return "too large";
  }
  if (field.kind === "birth_year" && typeof value === "number") {
    if (v.min_age !== undefined && value > new Date().getFullYear() - v.min_age) return "too young";
  }
  if (field.kind === "multiselect" && Array.isArray(value)) {
    if (v.min_selected !== undefined && value.length < v.min_selected) return "too few selected";
    if (v.max_selected !== undefined && value.length > v.max_selected) return "too many selected";
  }
  return null;
}

/**
 * Validate a response object against the form template. Required fields are
 * only enforced here (called at submit, never while drafting — H12). Also
 * type-checks each provided value against its field kind.
 */
export function validateResponses(
  template: TemplateField[],
  responses: Record<string, unknown>,
): void {
  const errors: Record<string, string> = {};
  for (const field of template) {
    const value = responses[field.key];
    if (isEmpty(value)) {
      if (field.required) errors[field.key] = "required";
      continue;
    }
    switch (field.kind) {
      case "number":
        if (typeof value !== "number") errors[field.key] = "must be a number";
        break;
      case "phone":
        if (typeof value !== "string" || normalizePhone(value) === null) {
          errors[field.key] = "must be a phone number";
        }
        break;
      case "birth_year":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < minimumBirthYear() ||
          value > new Date().getFullYear()
        ) {
          errors[field.key] = "must be a birth year";
        }
        break;
      case "checkbox":
        if (typeof value !== "boolean") errors[field.key] = "must be a boolean";
        else if (field.required && value !== true) errors[field.key] = "required";
        break;
      case "library":
        if (
          !Array.isArray(value) ||
          value.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)
        )
          errors[field.key] = "must be an array";
        break;
      case "multiselect": {
        if (!Array.isArray(value)) {
          errors[field.key] = "must be an array";
          break;
        }
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (value.some((v) => !allowed.has(String(v)))) errors[field.key] = "invalid option";
        break;
      }
      case "select": {
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (!allowed.has(String(value))) errors[field.key] = "invalid option";
        break;
      }
      case "file":
        if (typeof value !== "string") errors[field.key] = "must be a string";
        break;
      case "images":
        if (!Array.isArray(value) || value.some((key) => typeof key !== "string"))
          errors[field.key] = "must be a list of images";
        else if (value.length > MAX_IMAGES_PER_FIELD) errors[field.key] = "too many images";
        break;
      case "university":
        // The value is a shared-library university id. The picker sends a
        // number, but accept a numeric string too (legacy rows / staff edits)
        // so a valid id is never rejected on a type technicality.
        if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
          errors[field.key] = "must be a university id";
        }
        break;
      case "degree":
        if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
          errors[field.key] = "must be a degree id";
        }
        break;
      case "city": {
        // A city answer is deliberately structured so city/province/country
        // survive separately for exports and application review.
        const location = value as Record<string, unknown>;
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          typeof location.city !== "string" ||
          location.city.trim() === "" ||
          typeof location.province !== "string" ||
          location.province.trim() === "" ||
          typeof location.country !== "string" ||
          location.country.trim() === ""
        ) {
          errors[field.key] = "must include city, province, and country";
        }
        break;
      }
      default:
        if (typeof value !== "string") errors[field.key] = "must be a string";
    }
    // H11: builder-defined response validation, on top of the kind-shape
    // check above (skipped once that already failed for this field).
    if (!errors[field.key] && field.validation) {
      const validationError = checkFieldValidation(field, value);
      if (validationError) errors[field.key] = validationError;
    }
    // H56: an applicant's consent to share a file with sponsors is optional,
    // never required, and only meaningful on a field the organizer marked so.
    if (field.kind === "file" && field.shareable_with_sponsors) {
      const shared = responses[sponsorShareKey(field.key)];
      if (shared !== undefined && typeof shared !== "boolean") {
        errors[sponsorShareKey(field.key)] = "must be a boolean";
      }
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new BadRequestError("Response fails template validation", {
      fields: errors,
      fieldReasons: Object.fromEntries(
        Object.entries(errors).map(([key, message]) => [
          key,
          FIELD_ERROR_REASON_BY_MESSAGE[message] ?? message,
        ]),
      ),
    });
  }
}
