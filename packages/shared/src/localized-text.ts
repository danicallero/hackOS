import type { Language } from "./locale.js";

/** H50: preferred translation, English, then authored text; whitespace is absent. */
export function resolveLocalizedText(
  canonical: string | null,
  translations: Partial<Record<Language, string | null>> | undefined,
  primaryLanguage: Language,
  language: Language,
): string | null {
  const fallbackLanguage = language === primaryLanguage || language === "en" ? undefined : "en";
  return (
    [
      language === primaryLanguage ? undefined : translations?.[language],
      fallbackLanguage ? translations?.[fallbackLanguage] : undefined,
      canonical,
    ].find((value) => typeof value === "string" && value.trim().length > 0) ?? null
  );
}
export function resolveScheduleText(
  item: {
    title: string;
    description: string | null;
    primaryLanguage: Language;
    titleI18n?: Partial<Record<Language, string>>;
    descriptionI18n?: Partial<Record<Language, string | null>>;
  },
  language: Language,
): { title: string; description: string | null } {
  return {
    title:
      resolveLocalizedText(item.title, item.titleI18n, item.primaryLanguage, language) ??
      item.title,
    description: resolveLocalizedText(
      item.description,
      item.descriptionI18n,
      item.primaryLanguage,
      language,
    ),
  };
}
export function resolveActivityText(
  item: {
    name: string;
    primaryLanguage: Language;
    nameI18n: Partial<Record<Language, string>>;
  },
  language: Language,
): string {
  return (
    resolveLocalizedText(item.name, item.nameI18n, item.primaryLanguage, language) ?? item.name
  );
}
