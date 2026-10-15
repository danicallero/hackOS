import { errorDetailsReason, errorReasonCopyKey } from "@hackos/shared/error-reasons";
import { SCAN_REPLAY_EXPIRED, SCANNER_REPLAY_MAX_AGE_DAYS } from "@hackos/shared/idempotency";
import commonEn from "@hackos/shared/locales/en/common.json";
import { ApiError } from "./api";
import type { MessageKey } from "./i18n";

type Translate = (key: MessageKey, vars?: Record<string, string>) => string;

/**
 * The specific business reason of an API error: `details.code`, falling back
 * to the generic top-level code. Branch on this, never on `message` (#996).
 */
export function apiErrorReason(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  return errorDetailsReason(err.details) ?? err.code ?? null;
}

/**
 * Localized copy for an API error's reason or status, or null when it has
 * neither. Never returns `ApiError.message` (English server copy, #1013).
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

/**
 * Stable, storable code for a failed scanner replay (persisted in the local
 * queue instead of the English message): the reason, else `http_<status>`,
 * else `network`.
 */
export function scanFailureCode(err: unknown): string {
  if (!(err instanceof ApiError)) return "network";
  const reason = apiErrorReason(err);
  return reason && errorReasonCopyKey(reason) in commonEn ? reason : `http_${err.status}`;
}

/** Localized text for a stored scan failure code; legacy English rows get generic copy. */
export function scanFailureText(code: string, t: Translate): string {
  if (code === SCAN_REPLAY_EXPIRED) {
    return t("scanReplayExpired", { days: String(SCANNER_REPLAY_MAX_AGE_DAYS) });
  }
  const key = errorReasonCopyKey(code);
  if (key in commonEn) return t(key as MessageKey);
  if (code === "http_401") return t("apiErrorSessionExpired");
  if (code === "http_403") return t("apiErrorForbidden");
  if (code === "http_429") return t("apiErrorRateLimited");
  if (/^http_5/.test(code)) return t("apiErrorServer");
  return t("requestError");
}
