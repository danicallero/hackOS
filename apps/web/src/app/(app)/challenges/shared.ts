import type { I18nText, Question } from "@hackos/shared/questions";
import type { Tone } from "@/lib/tones";

export type Visibility = "visible" | "hidden";

export interface Prize {
  name: string;
  link?: string | null;
}

export interface Challenge {
  id: number;
  author?: number;
  title: string;
  description: string;
  criteria: string | null;
  prizes: Prize[] | null;
  judging_panel_criteria: Question[] | null;
  max_presentation_seconds: number | null;
  visibility: Visibility;
  available_from: string | null;
  created_at: string;
  updated_at: string;
}

export function visibilityTone(v: Visibility): Tone {
  return v === "visible" ? "success" : "neutral";
}

/** A challenge whose scheduled reveal is still in the future. */
export function isScheduled(availableFrom: string | null): boolean {
  if (!availableFrom) return false;
  const at = new Date(availableFrom);
  return !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
}

export function toJsonText(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

export function parseJsonField(value: string, fallback: unknown): unknown {
  if (!value.trim()) return fallback;
  return JSON.parse(value);
}

export function i18nWithEnglishFallback(value: Partial<I18nText>): I18nText {
  const en = value.en?.trim() ?? "";
  return {
    en,
    es: value.es?.trim() || en,
    gl: value.gl?.trim() || en,
  };
}

export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
