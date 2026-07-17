import type { Language } from "./types";

export const LANGUAGE_PREFERENCE_KEY = "hackos-language";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "es" || value === "gl" || value === "en";
}

export function resolveLanguage(value: string | null | undefined): Language {
  return isLanguage(value) ? value : "es";
}
