"use client";

// Applications module — shared types & helpers (H11–H14).
//
// The application `template` is a form schema validated server-side by
// `templateFieldSchema` (apps/api/src/modules/applications/schemas.ts): an
// ordered array of fields the client renders dynamically. This is DISTINCT
// from the judging panel `questionSchema` in @hackos/shared/questions — the
// applications form uses FIELD_KINDS below and i18n labels {en,es,gl}
// (plan/07 §2). Types are declared locally per module conventions.

import type { Tone } from "@/lib/tones";

export interface I18nText {
  en: string;
  es: string;
  gl: string;
}

export const APPLICATION_TYPES = ["participant", "mentor", "sponsor", "volunteer"] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

/** Types that require a shirt size at submit (logistics) — shown as a hint. */
export const SHIRT_TYPES: ApplicationType[] = ["participant", "mentor"];

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

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  text: "Short text",
  textarea: "Long text",
  select: "Single choice",
  multiselect: "Multiple choice",
  checkbox: "Checkbox",
  date: "Date",
  number: "Number",
  "file-url": "File URL",
  file: "File upload",
  university: "University",
};

/** Kinds that require a non-empty options array (server refine). */
export const OPTION_KINDS: FieldKind[] = ["select", "multiselect"];

/** Kind that carries upload restrictions (allowed_file_types, max_file_size_mb). */
export const FILE_KIND: FieldKind = "file";

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

export interface ApplicationForm {
  id: number;
  name: string;
  type: ApplicationType;
  template: TemplateField[];
  description: string | null;
  active: boolean;
  open_at: string | null;
  close_at: string | null;
  capacity: number | null;
  confirmation_window_hours: number;
  created_at: string;
}

/** A response as returned by GET /api/applications/:id/responses (review list). */
export interface ResponseRow {
  id: number;
  user_id: number;
  name: string | null;
  email: string;
  /** Logistics shirt size, from the user row (H12). */
  shirt_size: string | null;
  /** Food intolerance ids, from the user row. */
  food_intolerances: number[];
  /** Free-text dietary notes, from the user row. */
  food_intolerance_notes: string | null;
  status: string;
  responses: Record<string, unknown>;
  staff_notes: string | null;
  submitted_at: string | null;
  decision_sent_at: string | null;
  /** pg avg() arrives as a numeric string or null. */
  avg_score: number | string | null;
  review_count: number;
}

/** Shape of GET /api/applications/:id/stats (subset we render). */
export interface ApplicationStats {
  application: { id: number; name: string; type: string; capacity: number | null };
  counts_by_status: Record<string, number>;
  funnel: {
    sent: number;
    still_in_window: number;
    expired: number;
    declined: number;
    confirmed: number;
  };
}

// ── status presentation ───────────────────────────────────────────────────────

export const RESPONSE_STATUSES = [
  "draft",
  "submitted",
  "review",
  "accepted_internal",
  "rejected_internal",
  "accepted",
  "rejected",
  "confirmed",
  "declined",
  "expired",
] as const;

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  submitted: "info",
  review: "warning",
  accepted_internal: "brand",
  rejected_internal: "danger",
  accepted: "brand",
  rejected: "danger",
  confirmed: "success",
  declined: "neutral",
  expired: "warning",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

// ── datetime-local <-> ISO helpers ────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO string (from the API) -> value for an <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO string (UTC) or null when blank. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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

/** avg_score may be a numeric string; render to 1 decimal or a dash. */
export function fmtScore(avg: number | string | null): string {
  if (avg === null || avg === undefined || avg === "") return "—";
  const n = Number(avg);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

// ── window state (mirrors service.isWindowOpen for display only) ──────────────

export function windowState(
  form: ApplicationForm,
  now = new Date(),
): { label: string; tone: Tone } {
  if (!form.active) return { label: "Inactive", tone: "neutral" };
  if (form.open_at && new Date(form.open_at) > now) return { label: "Scheduled", tone: "info" };
  if (form.close_at && new Date(form.close_at) <= now) return { label: "Closed", tone: "neutral" };
  return { label: "Open", tone: "success" };
}
