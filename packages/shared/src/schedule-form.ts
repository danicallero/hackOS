import type { Language } from "./locale.js";
export type ScheduleAudience = "sponsor" | "participant" | "mentor";
const LANGUAGES: Language[] = ["es", "gl", "en"];
export interface ScheduleInput {
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  requiresScan: boolean;
  startsAt: string;
  endsAt: string;
  visibility: "shown" | "hidden";
  publishAt: string | null;
  audiences: ScheduleAudience[];
  contactNote: string | null;
  notes: string | null;
  /** Opt-in attendee Live Activity; only an item with an audience can have it (#966). */
  liveActivityAudience?: boolean;
  /** Language `title`/`description` are written in, when it isn't the editor's own (single-language entry). */
  titleLanguage?: Language;
}

export type ScheduleTranslation = { title?: string; description?: string | null };
export type ScheduleTranslations = Partial<Record<Language, ScheduleTranslation>>;

export interface ScheduleFormItem {
  title: string;
  description: string | null;
  primaryLanguage: Language;
  titleI18n?: Partial<Record<Language, string>>;
  descriptionI18n?: Partial<Record<Language, string | null>>;
  location?: string | null;
  type?: string | null;
  requiresScan?: boolean;
  startsAt: string;
  endsAt: string;
  visibility?: "shown" | "hidden";
  publishAt?: string | null;
  audiences?: ScheduleAudience[];
  liveActivityAudience?: boolean;
  contactNote?: string | null;
  notes?: string | null;
}
export function scheduleItemToForm(
  item: ScheduleFormItem,
  accountLanguage: Language,
): ScheduleInput {
  const resolved =
    item.primaryLanguage === accountLanguage
      ? { title: item.title, description: item.description }
      : {
          title: item.titleI18n?.[accountLanguage] ?? "",
          description: item.descriptionI18n?.[accountLanguage] ?? null,
        };
  return {
    title: resolved.title,
    description: resolved.description,
    location: item.location ?? null,
    type: item.type ?? "activity",
    requiresScan: item.requiresScan ?? false,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    visibility: item.visibility ?? "hidden",
    publishAt: item.publishAt ?? null,
    audiences: item.audiences ?? [],
    liveActivityAudience: item.liveActivityAudience ?? false,
    contactNote: item.contactNote ?? null,
    notes: item.notes ?? null,
  };
}
export function scheduleItemToTranslations(
  item: ScheduleFormItem,
  accountLanguage: Language,
): ScheduleTranslations {
  const translations: ScheduleTranslations = {};
  for (const language of LANGUAGES) {
    if (language === accountLanguage) continue;
    if (language === item.primaryLanguage) {
      translations[language] = { title: item.title, description: item.description };
      continue;
    }
    const title = item.titleI18n?.[language];
    const description = item.descriptionI18n?.[language];
    if (title !== undefined || description !== undefined) {
      translations[language] = { title, description };
    }
  }
  return translations;
}
export function prepareScheduleSubmission<
  T extends { title: string; description?: string | null; titleLanguage?: Language },
>(
  values: T,
  translations: ScheduleTranslations,
): { values: T; translations: ScheduleTranslations } | null {
  const cleaned: ScheduleTranslations = {};
  for (const language of LANGUAGES) {
    const title = translations[language]?.title?.trim();
    const description = translations[language]?.description?.trim();
    // The API rejects empty strings; a blank field simply isn't sent.
    if (title || description) {
      cleaned[language] = {
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      };
    }
  }

  const title = values.title.trim();
  if (title) return { values: { ...values, title }, translations: cleaned };

  const source = LANGUAGES.find((language) => cleaned[language]?.title);
  if (!source) return null;
  const { [source]: promoted, ...rest } = cleaned;
  return {
    values: {
      ...values,
      title: promoted?.title ?? "",
      description: promoted?.description ?? null,
      titleLanguage: source,
    },
    translations: rest,
  };
}
