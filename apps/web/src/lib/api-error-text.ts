import { errorReasonCopyKey } from "@hackos/shared/error-reasons";
import commonEn from "@hackos/shared/locales/en/common.json";
import { ApiError } from "@/lib/api";
import { apiErrorReason } from "@/lib/api-error-reason";
import type { MessageKey, Translate } from "@/lib/i18n";

/**
 * Localized copy for an API error's reason or status, or null when the error
 * has neither. Never returns `ApiError.message` (English server copy, #1013).
 */
export function apiErrorCopy(err: unknown, t: Translate): string | null {
  if (!(err instanceof ApiError)) return null;
  const reason = apiErrorReason(err);
  if (reason) {
    const key = errorReasonCopyKey(reason);
    if (key in commonEn) return t(key as MessageKey);
  }
  if (err.status === 401) return t("apiErrorSessionExpired");
  if (err.status === 403) return t("apiErrorForbidden");
  if (err.status === 429) return t("apiErrorRateLimited");
  if (err.status >= 500) return t("apiErrorServer");
  return null;
}

/** Localized text for a failed request: reason copy, else the caller's own fallback. */
export function apiErrorText(err: unknown, t: Translate, fallback: string): string {
  return apiErrorCopy(err, t) ?? fallback;
}

/**
 * Like `apiErrorText` for code that may also throw client-authored (already
 * localized) `Error`s: those keep their message, API errors never do.
 */
export function errorText(err: unknown, t: Translate, fallback: string): string {
  if (err instanceof ApiError) return apiErrorText(err, t, fallback);
  return err instanceof Error ? err.message : fallback;
}
