/**
 * Constants shared across the application-detail route's files (H11-H14).
 */

import type { I18nText } from "@hackos/shared/questions";

/** Locale tab order for every trilingual editor on this page. */
export const LOCALES = ["es", "en", "gl"] as const;

/** A blank trilingual value — every i18n field must carry all three (plan/07 §2). */
export const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };
