// Participant-facing "My applications" flow — shared types & helpers (H12–H15).
//
// This is the APPLICANT view (distinct from the admin Applications module under
// /applications). It renders the same application `template` the API validates
// server-side (apps/api/src/modules/applications/schemas.ts: templateFieldSchema)
// but only ever hits the applicant endpoints (me.routes.ts / confirm.routes.ts /
// the public read of open forms).

import { ApiError } from "@/lib/api";
import type { FormSection, TemplateField } from "@/lib/applications";
import type { Translate } from "@/lib/i18n";
import type { Tone } from "@/lib/tones";

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
  can_delete_draft: boolean;
}

/**
 * GET /api/applications/:id/response — my saved response for one form. `status`
 * is masked (accepted/rejected before the decision is sent read as "review").
 */
export interface MyResponseDetail {
  can_delete_draft?: boolean;
  id: number;
  user_id: number;
  application_id: number;
  status: string;
  responses: Record<string, unknown>;
  decision_sent_at: string | null;
  /** Only present once a rejection has been sent. */
  rejection_reason?: string | null;
  confirmation_expires_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  application_name?: string;
  application_description?: string | null;
  open_at?: string | null;
  close_at?: string | null;
  ask_shirt_size?: boolean;
  ask_food_intolerances?: boolean;
  shirt_size?: string | null;
  food_intolerances?: number[];
  food_intolerance_notes?: string | null;
  allow_resubmit_after_close?: boolean;
  auto_accept_on_resubmit?: boolean;
  /** Immutable form snapshot the response is validated against. */
  template?: TemplateField[];
  sections?: FormSection[];
}

/** Seed a form from its saved response, using profile data only for open forms. */
export function seedApplicationValues(
  response: MyResponseDetail | null,
  form: Pick<PublicForm, "ask_shirt_size" | "ask_food_intolerances" | "template"> | null,
  profile: {
    shirtSize?: string | null;
    foodIntolerances?: number[];
    foodIntoleranceNotes?: string | null;
    dni?: string | null;
  } | null,
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(response?.responses ?? {}) };
  if (values.shirt_size == null) {
    const responseSize = response?.ask_shirt_size ? response.shirt_size : null;
    const profileSize = form?.ask_shirt_size ? profile?.shirtSize : null;
    if (responseSize != null) values.shirt_size = responseSize;
    else if (profileSize) values.shirt_size = profileSize;
  }
  if (values.food_intolerances == null) {
    const responseIntolerances = response?.ask_food_intolerances
      ? response.food_intolerances
      : null;
    if (responseIntolerances != null) {
      values.food_intolerances = responseIntolerances.map(String);
    } else if (form?.ask_food_intolerances && profile?.foodIntolerances?.length) {
      values.food_intolerances = profile.foodIntolerances.map(String);
    }
  }
  if (values.food_intolerance_notes == null) {
    const responseNotes = response?.ask_food_intolerances ? response.food_intolerance_notes : null;
    if (responseNotes != null) values.food_intolerance_notes = responseNotes;
    else if (form?.ask_food_intolerances && profile?.foodIntoleranceNotes) {
      values.food_intolerance_notes = profile.foodIntoleranceNotes;
    }
  }
  const dniField = form?.template.find((field) => field.key.trim().toLowerCase() === "dni");
  if (dniField && values[dniField.key] == null && profile?.dni) {
    values[dniField.key] = profile.dni;
  }
  return values;
}

/** A single response value, keyed by field.key in the responses object. */
export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | { city: string; province: string; country: string }
  | null
  | undefined;

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
