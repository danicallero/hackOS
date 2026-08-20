import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "./api";
import { haptic } from "./haptics";
import { useMeContext } from "./me-context";
import { emitNotificationChange, subscribeToNotificationChanges } from "./notification-events";
import type { ScheduleItem } from "./schedule";
import { useCachedApi } from "./use-cached-api";

type Channel = "in_app" | "email" | "push" | "discord";

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
}

export type CategoryState = "on" | "off" | "partial";

const CHANNEL: Channel = "push";

export function itemCategory(id: number): string {
  return `schedule:${id}`;
}

export function kindCategory(kind: string): string {
  return `schedule:type:${kind}`;
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
 * H59 per-category schedule notification model. Storage is the existing H51
 * `notification_preferences` table — no new tables:
 *  - `schedule:type:<kind>` enabled=true is the category-wide subscription flag.
 *  - `schedule:<id>` enabled=true is an individual opt-in when its category
 *    isn't subscribed, or a muted entry (enabled=false) when it is.
 * The reminder job (schedule-reminders.ts) already lets an item-level row
 * win over the category one, so muting an entry here actually suppresses it.
 */
export function useScheduleNotifications(items: ScheduleItem[]) {
  const { me } = useMeContext();
  const fetchPreferences = useCallback(
    () => apiFetch<Preferences>("/api/me/notification-preferences"),
    [],
  );
  const {
    data: prefs,
    load,
    setData,
    error: loadError,
  } = useCachedApi(
    `user:${me?.id ?? "unknown"}:schedule-notification-preferences`,
    fetchPreferences,
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const retryAction = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => subscribeToNotificationChanges(() => void load()), [load]);

  const itemRow = useCallback(
    (itemId: number) =>
      prefs?.overrides.find(
        (row) => row.category === itemCategory(itemId) && row.channel === CHANNEL,
      ),
    [prefs],
  );

  const kindRow = useCallback(
    (kind: string) =>
      prefs?.overrides.find(
        (row) => row.category === kindCategory(kind) && row.channel === CHANNEL,
      ),
    [prefs],
  );

  const isEntrySubscribed = useCallback(
    (item: Pick<ScheduleItem, "id" | "type">): boolean => {
      const own = itemRow(item.id);
      if (own) return own.enabled;
      return item.type ? (kindRow(item.type)?.enabled ?? false) : false;
    },
    [itemRow, kindRow],
  );

  const categoryState = useCallback(
    (kind: string): CategoryState => {
      if (!kindRow(kind)?.enabled) return "off";
      const kindItems = items.filter((item) => item.type === kind);
      const hasMuted = kindItems.some((item) => itemRow(item.id)?.enabled === false);
      return hasMuted ? "partial" : "on";
    },
    [items, itemRow, kindRow],
  );

  const toggleEntry = useCallback(
    async (item: ScheduleItem) => {
      if (!prefs) return;
      const key = itemCategory(item.id);
      const currentlySubscribed = isEntrySubscribed(item);
      const category = itemCategory(item.id);
      retryAction.current = () => toggleEntry(item);
      setSavingKey(key);
      setActionError(null);
      try {
        const next = await savePreferences([
          { category, channel: CHANNEL, enabled: !currentlySubscribed },
        ]);
        setData(next);
        emitNotificationChange();
        void haptic("selection");

        // Promotion: once every currently-loaded item of this kind has been
        // individually subscribed, fold that into the category flag instead
        // of leaving a pile of identical per-item rows.
        if (!currentlySubscribed && item.type) {
          const kindItems = items.filter((candidate) => candidate.type === item.type);
          const allSubscribed = kindItems.every((candidate) =>
            candidate.id === item.id
              ? true
              : (next.overrides.find(
                  (row) => row.category === itemCategory(candidate.id) && row.channel === CHANNEL,
                )?.enabled ?? false),
          );
          if (allSubscribed && kindRow(item.type)?.enabled !== true) {
            const promoted = await savePreferences([
              { category: kindCategory(item.type), channel: CHANNEL, enabled: true },
            ]);
            setData(promoted);
            emitNotificationChange();
          }
        }
      } catch (cause) {
        setActionError(cause instanceof Error ? cause : new Error("Notification update failed"));
      } finally {
        setSavingKey(null);
      }
    },
    [prefs, setData, isEntrySubscribed, items, kindRow],
  );

  const toggleCategory = useCallback(
    async (kind: string, enabled: boolean) => {
      if (!prefs) return;
      const key = kindCategory(kind);
      retryAction.current = () => toggleCategory(kind, enabled);
      setSavingKey(key);
      setActionError(null);
      try {
        const kindItems = items.filter((item) => item.type === kind);
        const preferences: Array<{ category: string; channel: Channel; enabled: boolean }> = [
          { category: key, channel: CHANNEL, enabled },
          // Clearing the muted (off) or stray individually-subscribed (on)
          // per-item rows keeps a later toggle starting from a clean slate.
          ...kindItems
            .filter((item) => itemRow(item.id) !== undefined)
            .map((item) => ({ category: itemCategory(item.id), channel: CHANNEL, enabled })),
        ];
        const next = await savePreferences(preferences);
        setData(next);
        emitNotificationChange();
        void haptic("selection");
      } catch (cause) {
        setActionError(cause instanceof Error ? cause : new Error("Notification update failed"));
      } finally {
        setSavingKey(null);
      }
    },
    [prefs, setData, items, itemRow],
  );

  const retry = useCallback(() => {
    if (retryAction.current) void retryAction.current();
    else void load();
  }, [load]);

  return {
    ready: Boolean(prefs),
    load,
    isEntrySubscribed,
    categoryState,
    toggleEntry,
    toggleCategory,
    savingKey,
    error: loadError ?? actionError,
    retry,
  };
}
