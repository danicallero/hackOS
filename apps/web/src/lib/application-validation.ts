import { ApiError } from "@/lib/api";
import { type I18nText, type MessageKey, pickText, type Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export interface ValidationField {
  key: string;
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
  const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) return field.required ? t("fieldRequired") : null;
  const rule = field.validation;
  let code: string | null = null;
  if ((field.kind === "text" || field.kind === "textarea") && typeof value === "string" && rule) {
    if (rule.min_length != null && value.length < rule.min_length) code = "too short";
    else if (rule.max_length != null && value.length > rule.max_length) code = "too long";
    else if (rule.pattern) {
      try {
        if (!new RegExp(rule.pattern).test(value)) code = "invalid format";
      } catch {
        code = "invalid format";
      }
    } else if (rule.text_condition === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      code = "invalid email";
    else if (rule.text_condition === "url") {
      try {
        new URL(value);
      } catch {
        code = "invalid url";
      }
    } else if (rule.text_condition === "contains" && !value.includes(rule.text_value ?? ""))
      code = "must contain text";
    else if (rule.text_condition === "not_contains" && value.includes(rule.text_value ?? ""))
      code = "must not contain text";
  } else if (field.kind === "number" && typeof value === "number" && rule) {
    if (rule.min != null && value < rule.min) code = "too small";
    else if (rule.max != null && value > rule.max) code = "too large";
  } else if (field.kind === "multiselect" && Array.isArray(value) && rule) {
    if (rule.min_selected != null && value.length < rule.min_selected) code = "too few selected";
    else if (rule.max_selected != null && value.length > rule.max_selected)
      code = "too many selected";
  }
  if (!code) return null;
  const custom = field.validation?.error_message
    ? pickText(field.validation.error_message, lang)
    : "";
  return (
    custom ||
    fieldErrorsFromApi({ details: { fields: { [field.key]: code } } }, t, [field], lang)[
      field.key
    ] ||
    t("fieldInvalid")
  );
}

/** Generic fallback copy per server validation-rule error code (H11). */
const VALIDATION_ERROR_KEYS: Record<string, MessageKey> = {
  "too short": "tooShort",
  "too long": "tooLong",
  "invalid format": "invalidFormat",
  "too small": "tooSmall",
  "too large": "tooLarge",
  "too few selected": "tooFewSelected",
  "too many selected": "tooManySelected",
  "must contain text": "mustContainText",
  "must not contain text": "mustNotContainText",
  "invalid email": "invalidEmail",
  "invalid url": "invalidUrl",
};

/** Extract and localize the per-field errors returned by template validation. */
export function fieldErrorsFromApi(
  err: unknown,
  t: Translate,
  template?: readonly ValidationField[],
  lang?: Language,
): Record<string, string> {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const fields = (err.details as { fields?: unknown }).fields;
    if (fields && typeof fields === "object") {
      return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => {
          const message = String(value);
          if (message === "required") return [key, t("fieldRequired")];
          if (message === "invalid option") return [key, t("fieldInvalidOption")];
          if (message === "must be a number") return [key, t("fieldMustBeNumber")];
          if (message === "must be a birth year") return [key, t("fieldMustBeBirthYear")];
          if (message === "must be a boolean") return [key, t("fieldMustBeBoolean")];
          if (message === "must be an array") return [key, t("fieldMustBeArray")];
          if (message === "must be a string") return [key, t("fieldMustBeString")];
          if (message === "must be a university id") return [key, t("fieldMustBeUniversity")];
          if (message === "must be a degree id") return [key, t("fieldMustBeDegree")];
          const validationKey = VALIDATION_ERROR_KEYS[message];
          if (validationKey) {
            const field = template?.find((candidate) => candidate.key === key);
            const custom =
              field?.validation?.error_message && lang
                ? pickText(field.validation.error_message, lang)
                : "";
            return [key, custom || t(validationKey)];
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
