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
  title_i18n: I18nText | null;
  description: string;
  description_i18n: I18nText | null;
  criteria: string | null;
  criteria_i18n: I18nText | null;
  prizes: Prize[] | null;
  judging_panel_criteria: Question[] | null;
  max_presentation_seconds: number | null;
  visibility: Visibility;
  available_from: string | null;
  /** Owning enterprise, joined by the list endpoints. */
  enterprise_name?: string | null;
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

export const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

/** Normalise a possibly-null i18n value from the API into an editable I18nText. */
export function asI18n(value: unknown, fallbackEn: string): I18nText {
  if (value && typeof value === "object") {
    const v = value as Partial<I18nText>;
    return { en: v.en ?? fallbackEn, es: v.es ?? "", gl: v.gl ?? "" };
  }
  return { en: fallbackEn, es: "", gl: "" };
}

export function i18nWithEnglishFallback(value: Partial<I18nText>): I18nText {
  const en = value.en?.trim() ?? "";
  return {
    en,
    es: value.es?.trim() || en,
    gl: value.gl?.trim() || en,
  };
}
