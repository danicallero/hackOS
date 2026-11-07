type TranslationMap = Record<string, string>;

/** Per-locale text from an `*_i18n` JSON column, falling back to the legacy single-language column as English. */
export function translationsOf(i18n: unknown, fallback: string | null): TranslationMap {
  const translations: TranslationMap = {};
  if (i18n && typeof i18n === "object" && !Array.isArray(i18n)) {
    for (const [locale, value] of Object.entries(i18n as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) translations[locale] = value;
    }
  }
  if (Object.keys(translations).length === 0 && fallback?.trim()) translations.en = fallback;
  return translations;
}
