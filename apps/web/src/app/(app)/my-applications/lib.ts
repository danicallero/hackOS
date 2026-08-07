// Participant-facing "My applications" flow — shared types & helpers (H12–H15).
//
// This is the APPLICANT view (distinct from the admin Applications module under
// /applications). It renders the same application `template` the API validates
// server-side (apps/api/src/modules/applications/schemas.ts: templateFieldSchema)
// but only ever hits the applicant endpoints (me.routes.ts / confirm.routes.ts /
// the public read of open forms). Types are declared locally per module rules.

import { ApiError } from "@/lib/api";
import { type I18nText, LOCALE_CODES, type Translate } from "@/lib/i18n";
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
  "file-url",
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
}

/** GET /api/public/applications[/:id] — an open form the applicant can render. */
export interface PublicForm {
  id: number;
  name: string;
  type: string;
  template: TemplateField[];
  description: string | null;
  active: boolean;
  open_at: string | null;
  close_at: string | null;
  capacity: number | null;
  confirmation_window_hours: number;
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
export function fieldErrorsFromApi(err: unknown, t: Translate): Record<string, string> {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const fields = (err.details as { fields?: unknown }).fields;
    if (fields && typeof fields === "object") {
      return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => {
          const message = String(value);
          if (message === "required") return [key, t("fieldRequired")];
          if (message === "invalid option") return [key, t("fieldInvalidOption")];
          if (message === "must be a number") return [key, t("fieldMustBeNumber")];
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
// size + dietary fields for participant/mentor forms only when returning a saved
// response. To show them in the form from the first render — before any draft
// exists — we mirror that enrichment here. The server re-enriches and validates
// on submit (it stays the source of truth), so this only governs presentation.

/** Application types that get shirt-size + dietary fields appended (H12). */
export const SHIRT_TYPES = ["participant", "mentor"];

const SHIRT_SIZE_FIELD: TemplateField = {
  key: "shirt_size",
  label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
  kind: "select",
  required: true,
  options: ["XS", "S", "M", "L", "XL", "XXL"].map((s) => ({
    value: s,
    label: { en: s, es: s, gl: s },
  })),
};

const FOOD_NOTES_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
};

/** Minimal shape of a food-intolerance dictionary entry (public endpoint). */
export interface IntoleranceOption {
  id: number;
  label: I18nText;
}

export function enrichTemplate(
  type: string,
  template: TemplateField[],
  intolerances: IntoleranceOption[],
): TemplateField[] {
  if (!SHIRT_TYPES.includes(type)) return template;
  let out = template;
  if (!out.some((f) => f.key === "shirt_size")) out = [...out, SHIRT_SIZE_FIELD];
  if (!out.some((f) => f.key === "food_intolerances")) {
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
    };
    out = [...out, foodField, FOOD_NOTES_FIELD];
  }
  return out;
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

// ── status presentation (the masked applicant-visible set) ────────────────────

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
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
    submitted: t("dataStatusSubmitted"),
    review: t("dataStatusReview"),
    accepted: t("statusAccepted"),
    confirmed: t("confirmed"),
    rejected: t("statusNotSelected"),
    declined: t("declined"),
    expired: t("dataStatusExpired"),
  };
  return map[status] ?? t("unknownStatus");
}

export function formTypeLabel(type: string, t: Translate): string {
  const map: Record<string, string> = {
    participant: t("applicationTypeParticipant"),
    mentor: t("applicationTypeMentor"),
    sponsor: t("applicationTypeSponsor"),
    volunteer: t("applicationTypeVolunteer"),
  };
  return map[type] ?? t("applicationTypeOther");
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
