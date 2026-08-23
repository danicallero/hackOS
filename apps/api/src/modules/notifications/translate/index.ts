import { config } from "../../../config.js";
import { ServiceUnavailableError } from "../../../lib/errors.js";
import type { AnnouncementTranslation } from "../announcements-service.js";
import { translateViaGoogle } from "./google.js";
import { translateViaLibreTranslate } from "./libretranslate.js";

/**
 * Isolated translation-provider boundary — every caller (announcements,
 * schedule, and indirectly both frontends) goes through `translateFields` /
 * `isTranslationAvailable` only, never a provider module directly.
 * TRANSLATE_PROVIDER (mirroring MAIL_PROVIDER, see channels/email.ts) picks
 * Google Translate or a self-hosted LibreTranslate instance. Entirely
 * optional: every caller must keep working with manual-only translation
 * entry when the selected provider isn't configured, so this module
 * deliberately reports availability rather than throwing on import when
 * unset.
 */
export function isTranslationAvailable(): boolean {
  return config.TRANSLATE_PROVIDER === "libretranslate"
    ? Boolean(config.LIBRETRANSLATE_URL)
    : Boolean(config.GOOGLE_TRANSLATE_API_KEY);
}

/** Originally H50 (announcements); the same es/gl/en set is now shared by every translatable entity. */
export type Language = "es" | "gl" | "en";

/** Language codes line up 1:1 with ours for both providers, Galician included — kept explicit rather than assumed. */
const LANGUAGE_CODES: Record<Language, string> = { es: "es", gl: "gl", en: "en" };

/**
 * Translates an arbitrary set of named text fields (e.g. `{title, body}` for
 * an announcement, `{title, description}` for a schedule item) from `source`
 * into every language in `targets`, keeping field identity so the caller
 * gets back the same shape per target locale. `source` is normally `"auto"`
 * — every caller lets the provider detect what was actually typed rather
 * than trusting a stored/assumed language, so staff can type primary content
 * in whatever language comes naturally, not just their account's. Throws
 * ServiceUnavailableError up front if the configured provider is missing its
 * credentials — callers (the route) turn that into a clean 503 rather than a
 * raw provider error, and every frontend treats that predictably
 * (hide/disable the action, never block manual entry).
 */
export async function translateFields<K extends string>(
  fields: Record<K, string>,
  source: Language | "auto",
  targets: Language[],
): Promise<Partial<Record<Language, Record<K, string>>>> {
  if (!isTranslationAvailable()) {
    throw new ServiceUnavailableError("Automatic translation is not configured on this deployment");
  }
  const keys = Object.keys(fields) as K[];
  const result: Partial<Record<Language, Record<K, string>>> = {};
  for (const target of targets) {
    if (target === source) continue;
    const texts = keys.map((key) => fields[key]);
    const targetCode = LANGUAGE_CODES[target];
    const sourceCode = source === "auto" ? "auto" : LANGUAGE_CODES[source];
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
    if (translated.length < keys.length) {
      throw new ServiceUnavailableError(
        `${config.TRANSLATE_PROVIDER} returned an unexpected response`,
      );
    }
    const entry = {} as Record<K, string>;
    keys.forEach((key, i) => {
      entry[key] = translated[i] as string;
    });
    result[target] = entry;
  }
  return result;
}

/**
 * Thin `translateFields` wrapper kept for the announcements route/tests'
 * existing {title, body} shape. `source` is accepted for backward
 * compatibility (it decides which targets the caller already excluded as
 * "the one already filled in") but the provider itself always auto-detects.
 */
export async function translateAnnouncementContent(
  content: AnnouncementTranslation,
  source: Language,
  targets: Language[],
): Promise<Partial<Record<Language, AnnouncementTranslation>>> {
  return translateFields(
    content,
    "auto",
    targets.filter((target) => target !== source),
  );
}
