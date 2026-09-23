import { ApiError } from "@/lib/api";
import { type I18nText, type MessageKey, pickText, type Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export interface ValidationField {
  key: string;
  label: I18nText;
  validation?: {
    error_message?: I18nText;
  };
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
