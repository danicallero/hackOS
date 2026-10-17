import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useLocale } from "./i18n";
import { clearLocalReminders, syncLocalReminders } from "./local-reminders";
import { subscribeToNotificationPreferenceChanges } from "./notification-events";
import { subscribeToServerEvent } from "./server-events";
import { registerSignOutListener } from "./sign-out-events";
import { useStreamRefresh } from "./use-stream-refresh";

const SYNC_DEBOUNCE_MS = 1_000;

/**
 * Keeps this device's local activity reminders in step with the schedule, the
 * event's reminder settings and the account's opt-ins, wherever those change:
 * app start and foreground, a schedule or settings change (public-content
 * stream), a preference change on another device or the web (personal
 * stream) and one made in this app.
 */
export function useLocalReminders({
  userId,
  enabled,
}: {
  userId: number | null;
  enabled: boolean;
}) {
  const { t, language } = useLocale();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ userId, language, t });
  latest.current = { userId, language, t };
  const active = enabled && userId !== null;

  const sync = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const { userId: id, language: lang, t: translate } = latest.current;
      if (id !== null) void syncLocalReminders({ userId: id, language: lang, t: translate });
    }, SYNC_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Start, account change and language change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: language and userId are the retrigger keys.
  useEffect(() => {
    if (active) sync();
  }, [active, sync, userId, language]);

  useEffect(() => {
    if (!active) return;
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    const preferences = subscribeToServerEvent(EVENTS.USER_NOTIFICATION_PREFERENCES_CHANGED, sync);
    const local = subscribeToNotificationPreferenceChanges(sync);
    return () => {
      appState.remove();
      preferences();
      local();
    };
  }, [active, sync]);

  useStreamRefresh(sync, { publicContent: true, enabled: active });

  // Reminders belong to the account; never leave them behind for the next one.
  useEffect(() => registerSignOutListener(clearLocalReminders), []);
}
