import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "./api";
import { useMeContext } from "./me-context";
import { emitNotificationChange, subscribeToNotificationChanges } from "./notification-events";
import { useCachedApi } from "./use-cached-api";

type Channel = "in_app" | "email" | "push" | "discord";

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
}

function savePreferences(
  preferences: Array<{ category: string; channel: Channel; enabled: boolean }>,
) {
  return apiFetch<Preferences>("/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}

/**
 * Per-activity reminder toggle shared by the calendar card bell and (if ever
 * needed again) the notifications preferences screen. A reminder is "on" when
 * every configured channel has an enabled override for `schedule:<activityId>`.
 */
export function useActivityReminders() {
  const { me } = useMeContext();
  const fetchPreferences = useCallback(
    () => apiFetch<Preferences>("/api/me/notification-preferences"),
    [],
  );
  const {
    data: prefs,
    load,
    setData,
  } = useCachedApi(`user:${me?.id ?? "unknown"}:notification-preferences`, fetchPreferences);
  const [savingId, setSavingId] = useState<number | null>(null);

  // useCachedApi's state is local to each call site (schedule list, activity
  // detail, the notifications preferences tab each mount their own instance),
  // so a toggle in one place is otherwise invisible to the others (H51).
  useEffect(() => subscribeToNotificationChanges(() => void load()), [load]);

  const isEnabled = useCallback(
    (activityId: number): boolean => {
      const category = `schedule:${activityId}`;
      return (
        prefs?.overrides.some(
          (row) => row.category === category && row.channel === "push" && row.enabled,
        ) ?? false
      );
    },
    [prefs],
  );

  const toggle = useCallback(
    async (activityId: number, enabled: boolean) => {
      if (!prefs) return;
      const category = `schedule:${activityId}`;
      setSavingId(activityId);
      try {
        const next = await savePreferences(
          prefs.channels.map((channel) => ({ category, channel, enabled })),
        );
        setData(next);
        emitNotificationChange();
      } finally {
        setSavingId(null);
      }
    },
    [prefs, setData],
  );

  return { ready: Boolean(prefs), load, isEnabled, toggle, savingId };
}
