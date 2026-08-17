"use client";

import commonEn from "@hackos/shared/locales/en/common.json";
import webEn from "@hackos/shared/locales/en/web.json";
import commonEs from "@hackos/shared/locales/es/common.json";
import webEs from "@hackos/shared/locales/es/web.json";
import commonGl from "@hackos/shared/locales/gl/common.json";
import webGl from "@hackos/shared/locales/gl/web.json";
import i18next from "i18next";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isLanguage, LANGUAGE_COOKIE_MAX_AGE, LANGUAGE_PREFERENCE_KEY } from "./locale";
import { useMe } from "./session";
import type { Language } from "./types";

export { isLanguage } from "./locale";

/** i18n label as stored by the API (plan/07 §2): all three locales. */
export interface I18nText {
  en: string;
  es: string;
  gl: string;
}

export const LANGS: Language[] = ["es", "gl", "en"];

export const LOCALE_CODES: Record<Language, string> = {
  es: "es-ES",
  gl: "gl-ES",
  en: "en-GB",
};

export function languageName(language: Language): string {
  return { es: "Castellano", gl: "Galego", en: "English" }[language];
}

export type MessageKey = keyof typeof webEn | keyof typeof commonEn;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * UI copy lives in packages/shared/locales/{en,es,gl}/{web,common}.json —
 * web.json for strings unique to web, common.json for the subset shared
 * verbatim with mobile (apps/mobile/lib/i18n.tsx reads the same files).
 * i18next resolves web.json first, falling back to common.json, so callers
 * don't need to know which file a key lives in.
 */
const i18nInstance = i18next.createInstance();
i18nInstance.init({
  lng: "es",
  fallbackLng: "es",
  ns: ["web", "common"],
  defaultNS: "web",
  fallbackNS: "common",
  resources: {
    es: { web: webEs, common: commonEs },
    gl: { web: webGl, common: commonGl },
    en: { web: webEn, common: commonEn },
  },
  interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
  returnNull: false,
  // Resources are bundled statically, so finish init synchronously instead
  // of deferring a tick — avoids a flash of raw keys on first render.
  initAsync: false,
});

/** Resolve one dictionary entry outside React, for navigation and copy checks. */
export function translateMessage(
  language: Language,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  return i18nInstance.getFixedT(language)(key, values);
}

interface LocaleContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
}
const LocaleContext = createContext<LocaleContextValue | null>(null);

declare global {
  interface Window {
    __hackosInitialLanguage?: Language;
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const [language, setLanguage] = useState<Language>("es");
  const bootLanguage = useRef<Language | null>(null);

  useLayoutEffect(() => {
    const initialLanguage = isLanguage(window.__hackosInitialLanguage)
      ? window.__hackosInitialLanguage
      : "es";
    bootLanguage.current = initialLanguage;
    setLanguage(initialLanguage);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.lang = language;
    if (bootLanguage.current === language) document.documentElement.dataset.localeReady = "true";
  }, [language]);

  useEffect(() => {
    if (isLanguage(me?.language)) setLanguage(me.language);
  }, [me?.language]);
  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, language);
    } catch {
      // Storage can be unavailable in private mode; the cookie still persists the choice.
    }
    // biome-ignore lint/suspicious/noDocumentCookie: the server needs this preference for matching SSR.
    document.cookie = `${LANGUAGE_PREFERENCE_KEY}=${language}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax`;
  }, [language]);
  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, values) => translateMessage(language, key, values),
    }),
    [language],
  );
  return createElement(LocaleContext.Provider, { value }, children);
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}

/** Pick the best available string for a language, falling back gracefully. */
export function pickText(text: I18nText | null | undefined, lang: Language = "es"): string {
  if (!text) return "";
  return text[lang] || LANGS.map((l) => text[l]).find(Boolean) || "";
}
