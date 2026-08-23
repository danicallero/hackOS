import { config } from "../../../config.js";
import { ServiceUnavailableError } from "../../../lib/errors.js";
import type { AnnouncementLanguage, AnnouncementTranslation } from "../announcements-service.js";
import { translateViaGoogle } from "./google.js";

/**
 * Isolated translation-provider boundary for H50 announcement content —
 * every caller (the /translate route, and indirectly both frontends) goes
 * through `translateAnnouncementContent` / `isTranslationAvailable` only,
 * never a provider module directly, so swapping Google Translate for
 * another engine later is a one-file change here plus a new `TRANSLATE_*`
 * env var, mirroring the MAIL_PROVIDER adapter split in
 * channels/email-adapters/. Entirely optional: every caller must keep
 * working with manual-only translation entry when no provider is
 * configured, so this module deliberately reports availability rather than
 * throwing on import when unset.
 */
export type TranslateFn = (
  texts: string[],
  target: string,
  source: string,
  apiKey: string,
) => Promise<string[]>;

export function isTranslationAvailable(): boolean {
  return Boolean(config.GOOGLE_TRANSLATE_API_KEY);
}

/** Google's language codes line up 1:1 with ours, Galician included — kept explicit rather than assumed. */
const LANGUAGE_CODES: Record<AnnouncementLanguage, string> = { es: "es", gl: "gl", en: "en" };

/**
 * Translates one announcement's title+body from `source` into every
 * language in `targets`. Throws ServiceUnavailableError up front if no
 * provider is configured — callers (the route) turn that into a clean 503
 * rather than a raw provider error, and both frontends treat that
 * predictably (hide/disable the action, never block manual entry).
 */
export async function translateAnnouncementContent(
  content: AnnouncementTranslation,
  source: AnnouncementLanguage,
  targets: AnnouncementLanguage[],
): Promise<Partial<Record<AnnouncementLanguage, AnnouncementTranslation>>> {
  const apiKey = config.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    throw new ServiceUnavailableError("Automatic translation is not configured on this deployment");
  }
  const result: Partial<Record<AnnouncementLanguage, AnnouncementTranslation>> = {};
  for (const target of targets) {
    if (target === source) continue;
    const translated = await translateViaGoogle(
      [content.title, content.body],
      LANGUAGE_CODES[target],
      LANGUAGE_CODES[source],
      apiKey,
    );
    if (translated.length < 2) {
      throw new ServiceUnavailableError("Google Translate returned an unexpected response");
    }
    result[target] = { title: translated[0] as string, body: translated[1] as string };
  }
  return result;
}
