import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { Language } from "@hackos/shared/locale";
import { ApiError } from "./api";
import { apiErrorReason } from "./api-error-reason";
import type { MessageKey } from "./i18n";
import type { ScheduleInput, ScheduleTranslations } from "./schedule";

const LANGUAGES: Language[] = ["es", "gl", "en"];

/**
 * Title and description only need to exist in ONE language (H48, H50
 * extension): every viewer falls back to English, then the authored language.
 * When the editor left their own language blank, the first filled translation
 * becomes the canonical text and `titleLanguage` tells the API which language
 * that is. Returns null when no language has a title.
 */
export function prepareScheduleSubmission(
  values: ScheduleInput,
  translations: ScheduleTranslations,
): { values: ScheduleInput; translations: ScheduleTranslations } | null {
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

const BUSINESS_ERROR_KEYS: Record<string, MessageKey> = {
  [ERROR_REASONS.SCHEDULE_ENDS_BEFORE_STARTS]: "scheduleErrorEndBeforeStart",
  [ERROR_REASONS.SCHEDULE_SCAN_NEEDS_PARTICIPANTS]: "scheduleErrorScanNeedsParticipants",
  [ERROR_REASONS.SCHEDULE_ITEM_NOT_FOUND]: "scheduleErrorNotFound",
};

/**
 * Localized reason a schedule save failed. Only a request that never reached
 * the server is reported as a connection problem; business and validation
 * errors from the API say what to fix.
 */
export function scheduleSaveError(
  error: unknown,
  t: (key: MessageKey, values?: Record<string, string>) => string,
): string {
  if (!(error instanceof ApiError)) return t("scheduleSaveError");
  const reason = apiErrorReason(error);
  const known = reason ? BUSINESS_ERROR_KEYS[reason] : undefined;
  if (known) return t(known);
  if (error.status === 401) return t("requestSessionExpired");
  if (error.status === 403) return t("scheduleErrorForbidden");
  if (error.status === 404) return t("scheduleErrorNotFound");
  if (error.status >= 500) return t("requestServerError");
  return t("scheduleSaveFailedReason", { reason: error.message });
}
