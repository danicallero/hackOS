import { channelEnabled, emailLocked } from "@hackos/shared/notification-channels";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api";
import { haptic } from "./haptics";
import { useMeContext } from "./me-context";
import {
  emitNotificationPreferenceChange,
  subscribeToNotificationPreferenceChanges,
} from "./notification-events";
import {
  type NotificationChannel,
  type NotificationPreferences,
  withNotificationOverrides,
} from "./notification-preferences";
import { useCachedApi } from "./use-cached-api";

const VALID_CHANNELS: NotificationChannel[] = ["in_app", "email", "push"];

/** Drops any stale channel a device cached before a channel was retired (e.g. the old Discord channel). */
export function validChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return channels.filter((channel) => VALID_CHANNELS.includes(channel));
}

function savePreferences(
  preferences: Array<{ category: string; channel: NotificationChannel; enabled: boolean }>,
) {
  return apiFetch<NotificationPreferences>("/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}

/**
 * H51: per-category, per-channel notification preferences with optimistic
 * toggles. Stays in sync with toggles made on other screens (the schedule
 * bell, reminder lists) through the preference-change channel (#626).
 */
export function useNotificationPreferences() {
  const { me } = useMeContext();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const actionRetry = useRef<(() => Promise<void>) | null>(null);

  const fetchPreferences = useCallback(
    () => apiFetch<NotificationPreferences>("/api/me/notification-preferences"),
    [],
  );
  const {
    data: prefs,
    loading,
    error,
    staleSince,
    load,
    setData,
  } = useCachedApi(`user:${me?.id ?? "unknown"}:notification-preferences`, fetchPreferences, {
    enabled: me !== null,
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToNotificationPreferenceChanges((next) => setData(next)), [setData]);

  // Older cached payloads lack the device fields: assume a device, so email stays an opt-in.
  const channelState = useMemo(
    () => ({
      mandatoryCategories: prefs?.mandatoryCategories ?? [],
      emailOptInCategories: prefs?.emailOptInCategories ?? [],
      hasPushDevice: prefs?.hasPushDevice ?? true,
      overrides: prefs?.overrides ?? [],
    }),
    [prefs],
  );

  const enabledFor = useCallback(
    (category: string, channel: NotificationChannel): boolean => {
      // Queue staff alerts are opt-in; every other category follows the shared rule.
      if (category === "queue.staff") {
        return (
          channelState.overrides.find((row) => row.category === category && row.channel === channel)
            ?.enabled ?? false
        );
      }
      return channelEnabled(channelState, category, channel);
    },
    [channelState],
  );

  const emailLockedFor = useCallback(
    (category: string) => emailLocked(channelState, category),
    [channelState],
  );

  async function toggle(category: string, channel: NotificationChannel, enabled: boolean) {
    if (!prefs) return;
    const key = `${category}:${channel}`;
    const previous = prefs;
    actionRetry.current = () => toggle(category, channel, enabled);
    setSavingKey(key);
    setActionError(null);
    // Optimistic: flip instantly, reconcile with the server in the
    // background — only revert if the request actually fails.
    setData(withNotificationOverrides(prefs, [{ category, channel, enabled }]));
    void haptic("selection");
    try {
      const next = await savePreferences([{ category, channel, enabled }]);
      setData(next);
      emitNotificationPreferenceChange(next);
    } catch (cause) {
      setData(previous);
      setActionError(cause instanceof Error ? cause : new Error("Failed to save preference"));
    } finally {
      setSavingKey(null);
    }
  }

  return {
    prefs,
    channels: prefs ? validChannels(prefs.channels) : [],
    loading,
    error,
    staleSince,
    load,
    enabledFor,
    emailLockedFor,
    toggle,
    savingKey,
    actionError,
    retry: () => {
      if (actionRetry.current) void actionRetry.current();
    },
  };
}
