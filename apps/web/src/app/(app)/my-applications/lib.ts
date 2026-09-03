// Participant-facing "My applications" flow — shared types & helpers (H12–H15).
//
// This is the APPLICANT view (distinct from the admin Applications module under
// /applications). It renders the same application `template` the API validates
// server-side (apps/api/src/modules/applications/schemas.ts: templateFieldSchema)
// but only ever hits the applicant endpoints (me.routes.ts / confirm.routes.ts /
// the public read of open forms). Types are declared locally per module rules.

import { ApiError } from "@/lib/api";
import { type I18nText, LOCALE_CODES, type MessageKey, pickText, type Translate } from "@/lib/i18n";
import type { Tone } from "@/lib/tones";
import type { Language } from "@/lib/types";

export const FIELD_KINDS = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "number",
  "file",
  "university",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldOption {
  value: string;
  label: I18nText;
}

export interface TemplateField {
  key: string;
  label: I18nText;
  kind: FieldKind;
  required: boolean;
  options?: FieldOption[];
  /** For kind "file": allowed extensions (".pdf") and size cap in MB (H12). */
  allowed_file_types?: string[];
  max_file_size_mb?: number;
  /** Groups this field under a `FormSection.key` (H11 form builder sections). */
  section_key?: string;
  /** Small helper text shown under the field (H11), e.g. a privacy note or
   *  formatting hint. Plain text; URLs are auto-linked on render. */
  help_text?: I18nText;
  /** Placeholder shown inside the empty input, for kinds the applicant types
   *  into (text/textarea/number). Falls back to a generic string. */
  placeholder?: I18nText;
  validation?: FieldValidation;
}

/** Response-validation rules (H11) — mirrors `apps/web/.../applications/lib.tsx`'s
 *  identically named type (types are declared locally per module convention). */
export interface FieldValidation {
  min_length?: number;
  max_length?: number;
  pattern?: string;
  text_condition?: "contains" | "not_contains" | "email" | "url";
  text_value?: string;
  min?: number;
  max?: number;
  min_selected?: number;
  max_selected?: number;
  error_message?: I18nText;
}

/** A named group of template fields (H11): title + optional description,
 *  rendered as a header above its member fields. */
export interface FormSection {
  key: string;
  title: I18nText;
  description?: I18nText;
}

/** GET /api/public/applications[/:id] — an open form the applicant can render. */
export interface PublicForm {
  id: number;
  name: string;
  /** H8: name of the form's highest-position granted role, or null
   *  if it grants none — replaces the retired static `type` field. */
  granted_role_name: string | null;
  template: TemplateField[];
  sections: FormSection[];
  description: string | null;
  open_at: string | null;
  close_at: string | null;
  capacity: number | null;
  confirmation_window_hours: number;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  created_at: string;
}

/** GET /api/me/applications item — my response summary across forms (masked status). */
export interface MyResponseSummary {
  id: number;
  application_id: number;
  application_name: string;
  status: string;
  submitted_at: string | null;
}

/**
 * GET /api/applications/:id/response — my saved response for one form. `status`
 * is masked (accepted/rejected before the decision is sent read as "review").
 */
export interface MyResponseDetail {
  id: number;
  user_id: number;
  application_id: number;
  status: string;
  responses: Record<string, unknown>;
  decision_sent_at: string | null;
  confirmation_expires_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A single response value, keyed by field.key in the responses object. */
export type FieldValue = string | number | boolean | string[] | null | undefined;

/** Extract the per-field errors the API returns on failed template validation. */
/** Generic fallback copy per server validation-rule error code (H11), used
 *  when the field itself has no builder-defined `validation.error_message`. */
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

export function fieldErrorsFromApi(
  err: unknown,
  t: Translate,
  template?: TemplateField[],
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
          const validationKey = VALIDATION_ERROR_KEYS[message];
          if (validationKey) {
            const field = template?.find((f) => f.key === key);
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

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function isConfirmationExpiredError(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") {
    return false;
  }
  const details = error.details as { code?: unknown; expired?: unknown };
  return details.code === "confirmation_expired" || details.expired === true;
}

export type ActionError = {
  message: string;
  action: "save" | "submit" | "confirm" | "decline";
};

export type MutationKey = { responseId: number; status: string; key: string };

// ── client mirror of the API's enrichTemplate (service.ts) ────────────────────
//
// The public form endpoint serves the RAW template; the server appends shirt
// size + dietary fields only when the form's ask_shirt_size/ask_food_intolerances
// flags are on, when returning a saved response. To show them in the form from
// the first render — before any draft exists — we mirror that enrichment here.
// The server re-enriches and validates on submit (it stays the source of
// truth), so this only governs presentation.

/** Reserved section the shirt-size/dietary fields are grouped under (H11) —
 *  synthetic, never stored in `application.sections`. Mirrors the identically
 *  named constant in `applications/[id]/shared.ts`. */
export const LOGISTICS_SECTION_KEY = "__logistics__";

export const LOGISTICS_SECTION: FormSection = {
  key: LOGISTICS_SECTION_KEY,
  title: { en: "Logistics", es: "Logística", gl: "Loxística" },
};

function shirtSizeField(sizes: string[]): TemplateField {
  return {
    key: "shirt_size",
    label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
    kind: "select",
    required: true,
    options: sizes.map((s) => ({ value: s, label: { en: s, es: s, gl: s } })),
    section_key: LOGISTICS_SECTION_KEY,
  };
}

const FOOD_NOTES_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
  section_key: LOGISTICS_SECTION_KEY,
};

/** Minimal shape of a food-intolerance dictionary entry (public endpoint). */
export interface IntoleranceOption {
  id: number;
  label: I18nText;
}

export function enrichTemplate(
  askShirtSize: boolean,
  askFoodIntolerances: boolean,
  template: TemplateField[],
  intolerances: IntoleranceOption[],
  shirtSizes: string[],
): TemplateField[] {
  let out = template;
  if (askShirtSize && !out.some((f) => f.key === "shirt_size"))
    out = [...out, shirtSizeField(shirtSizes)];
  if (askFoodIntolerances && !out.some((f) => f.key === "food_intolerances")) {
    const foodField: TemplateField = {
      key: "food_intolerances",
      label: {
        en: "Dietary restrictions",
        es: "Restricciones dietéticas",
        gl: "Restricións dietéticas",
      },
      kind: "multiselect",
      required: false,
      options: intolerances.map((i) => ({ value: String(i.id), label: i.label })),
      section_key: LOGISTICS_SECTION_KEY,
    };
    out = [...out, foodField, FOOD_NOTES_FIELD];
  }
  return out;
}

/** Appends the synthetic Logistics section whenever any logistics field is
 *  present, so `groupFieldsBySections` can group them under a real header. */
export function withLogisticsSection(
  sections: FormSection[],
  hasLogisticsFields: boolean,
): FormSection[] {
  return hasLogisticsFields ? [...sections, LOGISTICS_SECTION] : sections;
}

/**
 * Keys of required template fields left empty in `values` (H12: client-side
 * check before submit — the API re-validates and stays the source of truth).
 */
export function missingRequiredFields(
  template: TemplateField[],
  values: Record<string, unknown>,
): string[] {
  return template
    .filter((f) => f.required)
    .filter((f) => {
      const v = values[f.key];
      return (
        v === undefined ||
        v === null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0) ||
        (f.kind === "checkbox" && v !== true)
      );
    })
    .map((f) => f.key);
}

// ── sections grouping (H11) ─────────────────────────────────────────────────

export interface FieldGroup {
  /** null = ungrouped fields, rendered with no header. */
  section: FormSection | null;
  fields: TemplateField[];
}

/**
 * Groups a flat field list under its sections, in section order, with any
 * fields whose `section_key` is unset or doesn't match a known section
 * leading as one ungrouped group — matching the builder's own layout, where
 * unassigned questions sit above the section blocks. Mirrors the builder's
 * identically-named helper (apps/web/src/app/(app)/applications/[id]/shared.ts)
 * so both surfaces render sections the same way.
 */
export function groupFieldsBySections(
  fields: TemplateField[],
  sections: FormSection[],
): FieldGroup[] {
  const knownKeys = new Set(sections.map((s) => s.key));
  const ungrouped = fields.filter((f) => !f.section_key || !knownKeys.has(f.section_key));
  const groups: FieldGroup[] = [{ section: null, fields: ungrouped }];
  for (const section of sections) {
    groups.push({ section, fields: fields.filter((f) => f.section_key === section.key) });
  }
  return groups.filter((g) => g.fields.length > 0);
}

// ── status presentation (the masked applicant-visible set) ────────────────────

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  review: "info",
  accepted: "success",
  confirmed: "success",
  rejected: "danger",
  declined: "danger",
  expired: "warning",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function statusLabel(status: string, t: Translate): string {
  const map: Record<string, string> = {
    draft: t("dataStatusDraft"),
    review: t("dataStatusReview"),
    accepted: t("statusAccepted"),
    confirmed: t("confirmed"),
    rejected: t("statusNotSelected"),
    declined: t("declined"),
    expired: t("dataStatusExpired"),
  };
  return map[status] ?? t("unknownStatus");
}

/**
 * H8: label for a form's `granted_role_name` — the name of its
 * highest-position granted role, or null if it grants none. Replaces the
 * retired static `type` field's display.
 */
export function formTypeLabel(grantedRoleName: string | null, t: Translate): string {
  return grantedRoleName ?? t("roleUnassigned");
}

// ── datetime ──────────────────────────────────────────────────────────────────

export function fmtDateTime(iso: string | null | undefined, language: Language = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
