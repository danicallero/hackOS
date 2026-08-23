import { config } from "../../../config.js";
import { ServiceUnavailableError } from "../../../lib/errors.js";
import type { AnnouncementLanguage, AnnouncementTranslation } from "../announcements-service.js";
import { translateViaGoogle } from "./google.js";
import { translateViaLibreTranslate } from "./libretranslate.js";

/**
 * Isolated translation-provider boundary for H50 announcement content —
 * every caller (the /translate route, and indirectly both frontends) goes
 * through `translateAnnouncementContent` / `isTranslationAvailable` only,
 * never a provider module directly. TRANSLATE_PROVIDER (mirroring
 * MAIL_PROVIDER, see channels/email.ts) picks Google Translate or a
 * self-hosted LibreTranslate instance. Entirely optional: every caller must
 * keep working with manual-only translation entry when the selected
 * provider isn't configured, so this module deliberately reports
 * availability rather than throwing on import when unset.
 */
export function isTranslationAvailable(): boolean {
  return config.TRANSLATE_PROVIDER === "libretranslate"
    ? Boolean(config.LIBRETRANSLATE_URL)
    : Boolean(config.GOOGLE_TRANSLATE_API_KEY);
}

/** Language codes line up 1:1 with ours for both providers, Galician included — kept explicit rather than assumed. */
const LANGUAGE_CODES: Record<AnnouncementLanguage, string> = { es: "es", gl: "gl", en: "en" };

/**
 * Translates one announcement's title+body from `source` into every
 * language in `targets`. Throws ServiceUnavailableError up front if the
 * configured provider is missing its credentials — callers (the route) turn
 * that into a clean 503 rather than a raw provider error, and both
 * frontends treat that predictably (hide/disable the action, never block
 * manual entry).
 */
export async function translateAnnouncementContent(
  content: AnnouncementTranslation,
  source: AnnouncementLanguage,
  targets: AnnouncementLanguage[],
): Promise<Partial<Record<AnnouncementLanguage, AnnouncementTranslation>>> {
  if (!isTranslationAvailable()) {
    throw new ServiceUnavailableError("Automatic translation is not configured on this deployment");
  }
  const result: Partial<Record<AnnouncementLanguage, AnnouncementTranslation>> = {};
  for (const target of targets) {
    if (target === source) continue;
    const texts = [content.title, content.body];
    const targetCode = LANGUAGE_CODES[target];
    const sourceCode = LANGUAGE_CODES[source];
    const translated =
      config.TRANSLATE_PROVIDER === "libretranslate"
        ? await translateViaLibreTranslate(
            texts,
            targetCode,
            sourceCode,
            config.LIBRETRANSLATE_URL as string,
            config.LIBRETRANSLATE_API_KEY,
          )
        : await translateViaGoogle(
            texts,
            targetCode,
            sourceCode,
            config.GOOGLE_TRANSLATE_API_KEY as string,
          );
    if (translated.length < 2) {
      throw new ServiceUnavailableError(
        `${config.TRANSLATE_PROVIDER} returned an unexpected response`,
      );
    }
    result[target] = { title: translated[0] as string, body: translated[1] as string };
  }
  return result;
}
