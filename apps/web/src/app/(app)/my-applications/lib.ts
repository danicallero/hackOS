// Participant-facing "My applications" flow — shared types & helpers (H12–H15).
//
// This is the APPLICANT view (distinct from the admin Applications module under
// /applications). It renders the same application `template` the API validates
// server-side (apps/api/src/modules/applications/schemas.ts: templateFieldSchema)
// but only ever hits the applicant endpoints (me.routes.ts / confirm.routes.ts /
// the public read of open forms). Types are declared locally per module rules.

import type { I18nText } from "@/lib/i18n";
import type { Tone } from "@/lib/tones";

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
  confirmed_at: string | null;
  declined_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A single response value, keyed by field.key in the responses object. */
export type FieldValue = string | number | boolean | string[] | null | undefined;

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

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  review: "In review",
  accepted: "Accepted",
  confirmed: "Confirmed",
  rejected: "Not selected",
  declined: "Declined",
  expired: "Expired",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

// ── datetime ──────────────────────────────────────────────────────────────────

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}
