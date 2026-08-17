import type { Language } from "@hackos/shared/locale";
import en from "@hackos/shared/locales/en/email.json" with { type: "json" };
import es from "@hackos/shared/locales/es/email.json" with { type: "json" };
import gl from "@hackos/shared/locales/gl/email.json" with { type: "json" };
import i18next, { type i18n as I18nInstance } from "i18next";

/**
 * Standalone i18next instance for email/push rendering (H7, H52). No React
 * binding — this runs in the notification dispatcher/worker, not a browser.
 * `escapeValue: false` because HTML-escaping happens downstream, once, on
 * the fully-interpolated string (see templates.ts renderBodyHtml/
 * brandWrapHtml) — escaping here too would double-escape entities.
 */
export const emailI18n: I18nInstance = i18next.createInstance();

let initialized = false;

export function ensureEmailI18nInitialized(): I18nInstance {
  if (!initialized) {
    emailI18n.init({
      lng: "en",
      fallbackLng: "en",
      ns: ["email"],
      defaultNS: "email",
      resources: {
        en: { email: en },
        es: { email: es },
        gl: { email: gl },
      },
      interpolation: { escapeValue: false, prefix: "{{", suffix: "}}" },
      returnNull: false,
    });
    initialized = true;
  }
  return emailI18n;
}

export function emailTemplateExists(key: string, language: Language): boolean {
  ensureEmailI18nInitialized();
  return emailI18n.exists(key, { lng: language });
}

export function translateEmail(
  key: string,
  language: Language,
  vars: Record<string, unknown>,
): string {
  ensureEmailI18nInitialized();
  return emailI18n.getFixedT(language, "email")(key, vars);
}
