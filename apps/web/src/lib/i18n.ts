import type { Language } from "./types";

/** i18n label as stored by the API (plan/07 §2): all three locales. */
export interface I18nText {
  en: string;
  es: string;
  gl: string;
}

const LANGS: Language[] = ["es", "gl", "en"];

/** Pick the best available string for a language, falling back gracefully. */
export function pickText(text: I18nText | null | undefined, lang: Language = "es"): string {
  if (!text) return "";
  return text[lang] || LANGS.map((l) => text[l]).find(Boolean) || "";
}
