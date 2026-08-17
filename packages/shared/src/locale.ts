/**
 * Canonical language catalogue (H7): the single source of truth for which
 * locales hackOS supports, shared by web, mobile, and the API's email/push
 * renderer so no surface can drift onto its own list.
 */
export const LANGUAGES = {
  EN: "en",
  ES: "es",
  GL: "gl",
} as const;

export type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES];

export const LANGS: Language[] = Object.values(LANGUAGES);

export const DEFAULT_LANGUAGE: Language = LANGUAGES.EN;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGS as string[]).includes(value);
}
