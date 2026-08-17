import { isLanguage, type Language } from "@hackos/shared/locale";
import commonEn from "@hackos/shared/locales/en/common.json";
import mobileEn from "@hackos/shared/locales/en/mobile.json";
import commonEs from "@hackos/shared/locales/es/common.json";
import mobileEs from "@hackos/shared/locales/es/mobile.json";
import commonGl from "@hackos/shared/locales/gl/common.json";
import mobileGl from "@hackos/shared/locales/gl/mobile.json";
import i18next from "i18next";
import { createElement, type ReactNode } from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";

/**
 * Mobile i18n (H7's language preference applies here too), now backed by
 * i18next/react-i18next instead of a hand-rolled dict — see
 * apps/web/src/lib/i18n.ts for the same migration on the web side, and
 * packages/shared/locales for the resource files both read from.
 * `mobile.json` holds the strings unique to mobile screens; `common.json`
 * holds the strings that are (or will become) byte-identical with web.
 */
export type Lang = Language;
export const isSupportedLanguage = isLanguage;

type Key = keyof typeof mobileEn | keyof typeof commonEn;

const instance = i18next.createInstance();
instance.use(initReactI18next);
instance.init({
  lng: "en",
  fallbackLng: "en",
  ns: ["mobile", "common"],
  defaultNS: "mobile",
  resources: {
    en: { mobile: mobileEn, common: commonEn },
    es: { mobile: mobileEs, common: commonEs },
    gl: { mobile: mobileGl, common: commonGl },
  },
  interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
  returnNull: false,
  // Resources are bundled statically, so finish init synchronously instead
  // of deferring a tick — avoids a flash of raw keys on first render.
  initAsync: false,
});

interface LocaleContextValue {
  language: Lang;
  setLanguage: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string>) => string;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n: instance }, children);
}

export function useLocale(): LocaleContextValue {
  const { t, i18n } = useTranslation(["mobile", "common"], { i18n: instance });
  return {
    language: i18n.language as Lang,
    setLanguage: (lang) => {
      i18n.changeLanguage(lang);
    },
    t: (key, vars) => t(key, vars),
  };
}
