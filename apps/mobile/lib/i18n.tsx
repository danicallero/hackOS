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
  activityReminders: {
    en: "Activity reminders",
    es: "Recordatorios de actividades",
    gl: "Recordatorios de actividades",
  },
  activityRemindersHint: {
    en: "Enable a reminder for any upcoming schedule item.",
    es: "Activa un recordatorio para cualquier elemento próximo del horario.",
    gl: "Activa un recordatorio para calquera elemento próximo do horario.",
  },
  save: { en: "Save", es: "Guardar", gl: "Gardar" },
  saved: { en: "Saved", es: "Guardado", gl: "Gardado" },
  scannerAccreditation: { en: "Accreditation", es: "Acreditación", gl: "Acreditación" },
  scannerBadge: { en: "Replace badge", es: "Reponer badge", gl: "Repoñer badge" },
  scannerPresence: { en: "Presence", es: "Presencia", gl: "Presenza" },
  scannerMeals: {
    en: "Meals / activities",
    es: "Comidas / actividades",
    gl: "Comidas / actividades",
  },
  scannerSync: { en: "Sync now", es: "Sincronizar", gl: "Sincronizar" },
  scannerSyncing: { en: "Syncing…", es: "Sincronizando…", gl: "Sincronizando…" },
  scannerNeverSynced: {
    en: "Never synchronized",
    es: "Nunca sincronizado",
    gl: "Nunca sincronizado",
  },
  scannerLastSync: {
    en: "Last sync: {time}",
    es: "Última sync: {time}",
    gl: "Última sync: {time}",
  },
  scannerTicket: { en: "Ticket QR", es: "QR de entrada", gl: "QR da entrada" },
  scannerBadgeId: { en: "Badge QR", es: "QR del badge", gl: "QR do badge" },
  scannerCurrentBadge: { en: "Current badge", es: "Badge actual", gl: "Badge actual" },
  scannerNewBadge: { en: "New badge", es: "Badge nuevo", gl: "Badge novo" },
  scannerReason: { en: "Reason", es: "Motivo", gl: "Motivo" },
  scannerLookup: { en: "Look up locally", es: "Buscar en local", gl: "Buscar en local" },
  scannerCamera: { en: "Scan QR", es: "Escanear QR", gl: "Escanear QR" },
  scannerConfirmAccreditation: { en: "Assign badge", es: "Asignar badge", gl: "Asignar badge" },
  scannerRotate: { en: "Rotate badge", es: "Rotar badge", gl: "Rotar badge" },
  scannerRegister: { en: "Register scan", es: "Registrar pase", gl: "Rexistrar pase" },
  scannerIn: { en: "Entry", es: "Entrada", gl: "Entrada" },
  scannerOut: { en: "Exit", es: "Salida", gl: "Saída" },
  scannerBackdated: {
    en: "Time (ISO, optional)",
    es: "Hora (ISO, opcional)",
    gl: "Hora (ISO, opcional)",
  },
  scannerSelectActivity: {
    en: "Select an activity",
    es: "Elige una actividad",
    gl: "Escolle unha actividade",
  },
  scannerUnknownTicket: {
    en: "Ticket not found in the local copy.",
    es: "La entrada no está en la copia local.",
    gl: "A entrada non está na copia local.",
  },
  scannerUnknownBadge: {
    en: "Badge not found in the local copy.",
    es: "El badge no está en la copia local.",
    gl: "O badge non está na copia local.",
  },
  scannerRevokedBadge: {
    en: "REJECTED: this badge is revoked.",
    es: "RECHAZADO: este badge está revocado.",
    gl: "REXEITADO: este badge está revogado.",
  },
  scannerNotEntitled: {
    en: "This person is not entitled to this meal.",
    es: "Esta persona no tiene asignada esta comida.",
    gl: "Esta persoa non ten asignada esta comida.",
  },
  scannerPendingAck: {
    en: "Saved locally; waiting for server acknowledgement.",
    es: "Guardado en local; esperando confirmación del servidor.",
    gl: "Gardado en local; agardando confirmación do servidor.",
  },
  scannerAcknowledged: {
    en: "Server acknowledged the scan.",
    es: "El servidor confirmó el pase.",
    gl: "O servidor confirmou o pase.",
  },
  scannerAccreditationPending: {
    en: "NOT CHECKED IN: waiting for the server OK.",
    es: "NO ACREDITADO: esperando el OK real del servidor.",
    gl: "NON ACREDITADO: agardando o OK real do servidor.",
  },
  scannerQueue: { en: "Device queue", es: "Cola del dispositivo", gl: "Cola do dispositivo" },
  scannerRetryFailed: {
    en: "Retry rejected scans",
    es: "Reintentar pases rechazados",
    gl: "Reintentar pases rexeitados",
  },
  scannerNoQueue: {
    en: "No scans stored on this device yet.",
    es: "Todavía no hay pases guardados en este dispositivo.",
    gl: "Aínda non hai pases gardados neste dispositivo.",
  },
  scannerConfirmed: { en: "Confirmed place", es: "Plaza confirmada", gl: "Praza confirmada" },
  scannerUnconfirmed: {
    en: "Place not confirmed",
    es: "Plaza no confirmada",
    gl: "Praza non confirmada",
  },
  scannerAlreadyCount: {
    en: "Previous scans: {count}",
    es: "Pases anteriores: {count}",
    gl: "Pases anteriores: {count}",
  },
  scannerRepeatTitle: { en: "Already served", es: "Ya se le ha servido", gl: "Xa se lle serviu" },
  scannerRepeatBody: {
    en: "This person already has {count} scan(s). Allow a repeat?",
    es: "Esta persona ya tiene {count} pase(s). ¿Permitir repetición?",
    gl: "Esta persoa xa ten {count} pase(s). Permitir repetición?",
  },
  cancel: { en: "Cancel", es: "Cancelar", gl: "Cancelar" },
  confirm: { en: "Confirm", es: "Confirmar", gl: "Confirmar" },
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
