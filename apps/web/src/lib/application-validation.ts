import { FIELD_ERROR_REASONS } from "@hackos/shared/error-reasons";
import { MINIMUM_APPLICANT_AGE } from "@hackos/shared/forms";
import { normalizePhone } from "@hackos/shared/phone";
import { youtubeEmbedUrl } from "@hackos/shared/youtube";
import { ApiError } from "@/lib/api";
import { type I18nText, type MessageKey, pickText, type Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export interface ValidationField {
  key: string;
  project_video?: boolean;
  options?: { value: string }[];
  label: I18nText;
  validation?: {
    min_length?: number;
    max_length?: number;
    pattern?: string;
    text_condition?: string;
    text_value?: string;
    min?: number;
    max?: number;
    min_selected?: number;
    max_selected?: number;
    error_message?: I18nText;
  };
}

/** Mirrors the server's H11 rules so users get feedback on blur, without
 * making an incomplete draft invalid while they are typing. */
export function validateFieldOnBlur(
  field: ValidationField & { kind?: string; required?: boolean },
  value: unknown,
  t: Translate,
  lang: Language,
): string | null {
  const empty =
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return field.required ? t("fieldRequired") : null;
  if (field.kind === "checkbox") {
    if (typeof value !== "boolean") return t("fieldMustBeBoolean");
    if (field.required && !value) return t("fieldRequired");
  }
  if (field.kind === "number" && (typeof value !== "number" || !Number.isFinite(value)))
    return t("fieldMustBeNumber");
  if (field.kind === "select" || field.kind === "multiselect") {
    const allowed = new Set(field.options?.map((option) => option.value) ?? []);
    if (field.kind === "multiselect" && !Array.isArray(value)) return t("fieldMustBeArray");
    const choices = Array.isArray(value) ? value : [value];
    if (choices.some((choice) => typeof choice !== "string" || !allowed.has(choice)))
      return t("fieldInvalidOption");
  }
  if (field.kind === "library" || field.kind === "images") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim()))
      return t("fieldMustBeArray");
  }
  if (field.kind === "university" || field.kind === "degree") {
    if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value)))
      return t(field.kind === "university" ? "fieldMustBeUniversity" : "fieldMustBeDegree");
  }
  if (field.kind === "city") {
    const location = value as Record<string, unknown>;
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      ["city", "province", "country"].some(
        (key) => typeof location[key] !== "string" || !String(location[key]).trim(),
      )
    )
      return t("fieldMustBeCity");
  }
  if (["text", "textarea", "date", "file"].includes(field.kind ?? "") && typeof value !== "string")
    return t("fieldMustBeString");
  if (field.project_video && !youtubeEmbedUrl(value)) return t("invalidUrl");
  if (field.kind === "birth_year") {
    const currentYear = new Date().getFullYear();
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < currentYear - 120 ||
      value > currentYear
    ) {
      return t("fieldMustBeBirthYear");
    }
    if (value > currentYear - MINIMUM_APPLICANT_AGE) return t("fieldBirthYearTooRecent");
  }
  if (field.kind === "phone" && (typeof value !== "string" || normalizePhone(value) === null)) {
    return t("fieldMustBePhone");
  }
  const rule = field.validation;
  let code: string | null = null;
  if ((field.kind === "text" || field.kind === "textarea") && typeof value === "string" && rule) {
    if (rule.min_length != null && value.length < rule.min_length)
      code = FIELD_ERROR_REASONS.TOO_SHORT;
    else if (rule.max_length != null && value.length > rule.max_length)
      code = FIELD_ERROR_REASONS.TOO_LONG;
    else if (rule.text_condition === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      code = FIELD_ERROR_REASONS.INVALID_EMAIL;
    else if (rule.text_condition === "url" && !SIMPLE_URL_RE.test(value))
      code = FIELD_ERROR_REASONS.INVALID_URL;
    else if (
      rule.text_condition === "contains" &&
      rule.text_value &&
      !value.includes(rule.text_value)
    )
      code = FIELD_ERROR_REASONS.MUST_CONTAIN_TEXT;
    else if (
      rule.text_condition === "not_contains" &&
      rule.text_value &&
      value.includes(rule.text_value)
    )
      code = FIELD_ERROR_REASONS.MUST_NOT_CONTAIN_TEXT;
    if (!code && rule.pattern) {
      try {
        if (!new RegExp(rule.pattern).test(value)) code = FIELD_ERROR_REASONS.INVALID_FORMAT;
      } catch {
        code = FIELD_ERROR_REASONS.INVALID_FORMAT;
      }
    }
  } else if (field.kind === "number" && typeof value === "number" && rule) {
    if (rule.min != null && value < rule.min) code = FIELD_ERROR_REASONS.TOO_SMALL;
    else if (rule.max != null && value > rule.max) code = FIELD_ERROR_REASONS.TOO_LARGE;
  } else if (field.kind === "multiselect" && Array.isArray(value) && rule) {
    if (rule.min_selected != null && value.length < rule.min_selected)
      code = FIELD_ERROR_REASONS.TOO_FEW_SELECTED;
    else if (rule.max_selected != null && value.length > rule.max_selected)
      code = FIELD_ERROR_REASONS.TOO_MANY_SELECTED;
  }
  if (!code) return null;
  const custom = field.validation?.error_message
    ? pickText(field.validation.error_message, lang)
    : "";
  return custom || t(validationMessageKey(code, field));
}

// Keep client feedback aligned with the permissive URL shape accepted by the
// API: a scheme is optional, but the value must still be domain-shaped.
const SIMPLE_URL_RE = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i;

/** Generic fallback copy per server validation-rule reason (H11). */
const VALIDATION_ERROR_KEYS: Record<string, MessageKey> = {
  [FIELD_ERROR_REASONS.TOO_SHORT]: "tooShort",
  [FIELD_ERROR_REASONS.TOO_LONG]: "tooLong",
  [FIELD_ERROR_REASONS.INVALID_FORMAT]: "invalidFormat",
  [FIELD_ERROR_REASONS.TOO_SMALL]: "tooSmall",
  [FIELD_ERROR_REASONS.TOO_LARGE]: "tooLarge",
  [FIELD_ERROR_REASONS.TOO_FEW_SELECTED]: "tooFewSelected",
  [FIELD_ERROR_REASONS.TOO_MANY_SELECTED]: "tooManySelected",
  [FIELD_ERROR_REASONS.MUST_CONTAIN_TEXT]: "mustContainText",
  [FIELD_ERROR_REASONS.MUST_NOT_CONTAIN_TEXT]: "mustNotContainText",
  [FIELD_ERROR_REASONS.INVALID_EMAIL]: "invalidEmail",
  [FIELD_ERROR_REASONS.INVALID_URL]: "invalidUrl",
};

/** Copy per server kind-shape reason. */
const FIELD_SHAPE_KEYS: Record<string, MessageKey> = {
  [FIELD_ERROR_REASONS.REQUIRED]: "fieldRequired",
  [FIELD_ERROR_REASONS.INVALID_OPTION]: "fieldInvalidOption",
  [FIELD_ERROR_REASONS.MUST_BE_NUMBER]: "fieldMustBeNumber",
  [FIELD_ERROR_REASONS.MUST_BE_BIRTH_YEAR]: "fieldMustBeBirthYear",
  [FIELD_ERROR_REASONS.BIRTH_YEAR_TOO_RECENT]: "fieldBirthYearTooRecent",
  [FIELD_ERROR_REASONS.MUST_BE_PHONE]: "fieldMustBePhone",
  [FIELD_ERROR_REASONS.MUST_BE_BOOLEAN]: "fieldMustBeBoolean",
  [FIELD_ERROR_REASONS.MUST_BE_ARRAY]: "fieldMustBeArray",
  [FIELD_ERROR_REASONS.MUST_BE_STRING]: "fieldMustBeString",
  [FIELD_ERROR_REASONS.MUST_BE_UNIVERSITY_ID]: "fieldMustBeUniversity",
  [FIELD_ERROR_REASONS.MUST_BE_DEGREE_ID]: "fieldMustBeDegree",
  [FIELD_ERROR_REASONS.MUST_BE_CITY]: "fieldMustBeCity",
};

function validationMessageKey(reason: string, field?: ValidationField): MessageKey {
  if (
    reason === FIELD_ERROR_REASONS.INVALID_FORMAT &&
    field?.validation?.text_condition === "email"
  ) {
    return "invalidEmail";
  }
  if (
    reason === FIELD_ERROR_REASONS.INVALID_FORMAT &&
    field?.validation?.text_condition === "url"
  ) {
    return "invalidUrl";
  }
  return VALIDATION_ERROR_KEYS[reason] ?? "fieldInvalid";
}

/** Extract and localize the per-field errors returned by template validation. */
export function fieldErrorsFromApi(
  err: unknown,
  t: Translate,
  template?: readonly ValidationField[],
  lang?: Language,
): Record<string, string> {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const fields = (err.details as { fieldReasons?: unknown }).fieldReasons;
    if (fields && typeof fields === "object") {
      return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => {
          const reason = String(value);
          const shapeKey = FIELD_SHAPE_KEYS[reason];
          if (shapeKey) return [key, t(shapeKey)];
          if (VALIDATION_ERROR_KEYS[reason]) {
            const field = template?.find((candidate) => candidate.key === key);
            const custom =
              field?.validation?.error_message && lang
                ? pickText(field.validation.error_message, lang)
                : "";
            return [key, custom || t(validationMessageKey(reason, field))];
          }
          return [key, t("fieldInvalid")];
        }),
      );
    }
  }
  return {};
}

/** Format localized field errors as a compact, readable toast description. */
export function validationErrorSummary(
  fieldErrors: Record<string, string>,
  template?: readonly ValidationField[],
  lang: Language = "es",
): string {
  const labels = new Map((template ?? []).map((field) => [field.key, pickText(field.label, lang)]));
  return Object.entries(fieldErrors)
    .map(([key, message]) => `${labels.get(key) || key}: ${message}`)
    .join("\n");
}
