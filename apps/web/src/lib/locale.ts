import type { Language } from "@hackos/shared/locale";

export { isLanguage } from "@hackos/shared/locale";

/** BCP 47 tag each app language formats dates and numbers with. */
export const LOCALE_CODES: Record<Language, string> = {
  es: "es-ES",
  gl: "gl-ES",
  en: "en-GB",
};

export const LANGUAGE_PREFERENCE_KEY = "hackos-language";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
