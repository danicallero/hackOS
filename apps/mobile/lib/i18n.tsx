import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

type Lang = "en" | "es" | "gl";
type I18nText = Record<Lang, string>;

/**
 * Minimal mobile i18n (H7's language preference applies here too). Structured
 * the same `{ en, es, gl }`-per-key shape as apps/web/src/lib/i18n.ts, but
 * only the strings Phase 1 screens need — not a port of the full web dict.
 */
const dict = {
  signInTitle: { en: "Sign in", es: "Iniciar sesión", gl: "Iniciar sesión" },
  emailLabel: { en: "Email", es: "Correo", gl: "Correo" },
  passwordLabel: { en: "Password", es: "Contraseña", gl: "Contrasinal" },
  signInButton: { en: "Sign in", es: "Entrar", gl: "Entrar" },
  signInError: {
    en: "Couldn't sign in — check your email and password.",
    es: "No se pudo iniciar sesión — revisa tu correo y contraseña.",
    gl: "Non se puido iniciar sesión — revisa o teu correo e contrasinal.",
  },
  tabSchedule: { en: "Schedule", es: "Horario", gl: "Horario" },
  tabQueue: { en: "My queue", es: "Mi turno", gl: "A miña quenda" },
  tabWallet: { en: "Wallet", es: "Cartera", gl: "Carteira" },
  tabNotifications: { en: "Notifications", es: "Avisos", gl: "Avisos" },
  tabScan: { en: "Scanners", es: "Escáneres", gl: "Escáneres" },
  loading: { en: "Loading…", es: "Cargando…", gl: "Cargando…" },
  retry: { en: "Retry", es: "Reintentar", gl: "Reintentar" },
  signOut: { en: "Sign out", es: "Cerrar sesión", gl: "Pechar sesión" },
  scheduleEmpty: {
    en: "Nothing published yet.",
    es: "Todavía no hay nada publicado.",
    gl: "Aínda non hai nada publicado.",
  },
  queueEmpty: {
    en: "You're not in any queue right now.",
    es: "No estás en ninguna cola ahora mismo.",
    gl: "Non estás en ningunha cola agora mesmo.",
  },
  queueCalled: { en: "Go to room {room}", es: "Ve a la sala {room}", gl: "Vai á sala {room}" },
  queuePrecalled: {
    en: "You're up soon — get ready",
    es: "Te toca pronto — prepárate",
    gl: "Tócache pronto — prepárate",
  },
  queuePosition: { en: "Position {n}", es: "Posición {n}", gl: "Posición {n}" },
  ticketLabel: { en: "Ticket", es: "Entrada", gl: "Entrada" },
  badgeLabel: { en: "Badge", es: "Badge", gl: "Badge" },
  noBadgeYet: {
    en: "You don't have a badge yet — get accredited at check-in.",
    es: "Todavía no tienes badge — acredítate en el check-in.",
    gl: "Aínda non tes badge — acredítate no check-in.",
  },
  addToAppleWallet: {
    en: "Add to Apple Wallet",
    es: "Añadir a Apple Wallet",
    gl: "Engadir a Apple Wallet",
  },
  addToGoogleWallet: {
    en: "Add to Google Wallet",
    es: "Añadir a Google Wallet",
    gl: "Engadir a Google Wallet",
  },
  notificationsMandatoryHint: {
    en: "Queue-call notices are always sent — they aren't optional.",
    es: "Los avisos de turno de cola siempre se envían — no son opcionales.",
    gl: "Os avisos de quenda de cola sempre se envían — non son opcionais.",
  },
  save: { en: "Save", es: "Guardar", gl: "Gardar" },
  saved: { en: "Saved", es: "Guardado", gl: "Gardado" },
  scanComingSoon: {
    en: "Offline scanning is coming in a later release. You have staff access to: {capabilities}.",
    es: "El escaneo offline llega en una versión posterior. Tienes acceso de staff a: {capabilities}.",
    gl: "O escaneo sen conexión chega nunha versión posterior. Tes acceso de staff a: {capabilities}.",
  },
} satisfies Record<string, I18nText>;

type Key = keyof typeof dict;

function interpolate(text: string, vars?: Record<string, string>): string {
  if (!vars) return text;
  return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), text);
}

interface LocaleContextValue {
  language: Lang;
  setLanguage: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Lang>("en");
  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => interpolate(dict[key][language], vars),
    }),
    [language],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function isSupportedLanguage(value: string): value is Lang {
  return value === "en" || value === "es" || value === "gl";
}
