import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "./api";
import { haptic } from "./haptics";
import { useMeContext } from "./me-context";
import {
  emitNotificationPreferenceChange,
  subscribeToNotificationPreferenceChanges,
} from "./notification-events";
import {
  type NotificationPreferences,
  type NotificationPreferenceUpdate,
  withNotificationOverrides,
} from "./notification-preferences";
import type { ScheduleItem } from "./schedule";
import { useCachedApi } from "./use-cached-api";

export type CategoryState = "on" | "off" | "partial";

const CHANNEL = "push" as const;

export function itemCategory(id: number): string {
  return `schedule:${id}`;
}

export function kindCategory(kind: string): string {
  return `schedule:type:${kind}`;
}

function savePreferences(preferences: NotificationPreferenceUpdate[]) {
  return apiFetch<NotificationPreferences>("/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}

function preferenceFor(
  prefs: NotificationPreferences,
  category: string,
): NotificationPreferenceUpdate | undefined {
  return prefs.overrides.find((row) => row.category === category && row.channel === CHANNEL);
}

function isEntrySubscribedFrom(
  prefs: NotificationPreferences,
  item: Pick<ScheduleItem, "id" | "type">,
): boolean {
  const own = preferenceFor(prefs, itemCategory(item.id));
  if (own) return own.enabled;
  return item.type ? (preferenceFor(prefs, kindCategory(item.type))?.enabled ?? false) : false;
}

interface PendingWrite {
  key: string;
  updates: NotificationPreferenceUpdate[];
  previous: NotificationPreferences;
  retry: () => Promise<void>;
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
    () => apiFetch<NotificationPreferences>("/api/me/notification-preferences"),
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
  const prefsRef = useRef<NotificationPreferences | null>(null);
  const pendingWritesRef = useRef<PendingWrite[]>([]);
  const processingWritesRef = useRef(false);
  const failedActionRef = useRef<PendingWrite | null>(null);

  const setLocalPreferences = useCallback(
    (next: NotificationPreferences) => {
      prefsRef.current = next;
      setData(next);
    },
    [setData],
  );

  // The cache hook can receive a stale reload while a write is in flight.
  // Keep the optimistic projection authoritative until the queued writes have
  // all settled, then allow normal cache updates again.
  useEffect(() => {
    if (!prefs) return;
    if (pendingWritesRef.current.length === 0 && !processingWritesRef.current) {
      prefsRef.current = prefs;
    } else if (prefsRef.current && prefs !== prefsRef.current) {
      setData(prefsRef.current);
    }
  }, [prefs, setData]);

  // Preference changes are local cache synchronization only. Inbox/unread
  // listeners intentionally continue to receive `emitNotificationChange` for
  // message mutations, but not for a reminder switch (H51, issue #626).
  useEffect(
    () =>
      subscribeToNotificationPreferenceChanges((next) => {
        if (pendingWritesRef.current.length > 0 || processingWritesRef.current) return;
        setLocalPreferences(next);
      }),
    [setLocalPreferences],
  );

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

  const drainWrites = useCallback(async () => {
    if (processingWritesRef.current) return;
    processingWritesRef.current = true;
    try {
      while (pendingWritesRef.current.length > 0) {
        const pending = pendingWritesRef.current[0];
        setSavingKey(pending.key);
        try {
          const serverPreferences = await savePreferences(pending.updates);
          pendingWritesRef.current.shift();
          let next = serverPreferences;
          // A rapid second tap is already reflected locally. Reapply those
          // queued intent updates over the committed response so the visible
          // state remains deterministic while requests are serialized.
          for (const queued of pendingWritesRef.current) {
            next = withNotificationOverrides(next, queued.updates);
          }
          setLocalPreferences(next);
          emitNotificationPreferenceChange(next);
          if (pendingWritesRef.current.length === 0 && !failedActionRef.current) {
            retryAction.current = null;
          }
        } catch (cause) {
          pendingWritesRef.current.shift();
          let next = pending.previous;
          for (const queued of pendingWritesRef.current) {
            next = withNotificationOverrides(next, queued.updates);
          }
          setLocalPreferences(next);
          emitNotificationPreferenceChange(next);
          failedActionRef.current = pending;
          retryAction.current = pending.retry;
          setActionError(cause instanceof Error ? cause : new Error("Notification update failed"));
        }
      }
    } finally {
      processingWritesRef.current = false;
      setSavingKey(null);
    }
  }, [setLocalPreferences]);

  const enqueueWrite = useCallback(
    (key: string, updates: NotificationPreferenceUpdate[], retry: () => Promise<void>) => {
      const current = prefsRef.current ?? prefs;
      if (!current) return;
      failedActionRef.current = null;
      retryAction.current = null;
      pendingWritesRef.current.push({ key, updates, previous: current, retry });
      setLocalPreferences(withNotificationOverrides(current, updates));
      setSavingKey(key);
      setActionError(null);
      void drainWrites();
    },
    [drainWrites, prefs, setLocalPreferences],
  );

  const toggleEntry = useCallback(
    (item: ScheduleItem) => {
      const current = prefsRef.current ?? prefs;
      if (!current) return;
      const key = itemCategory(item.id);
      const category = itemCategory(item.id);
      const currentlySubscribed = isEntrySubscribedFrom(current, item);
      const updates: NotificationPreferenceUpdate[] = [
        { category, channel: CHANNEL, enabled: !currentlySubscribed },
      ];

      // Promotion: once every currently-loaded item of this kind has been
      // individually subscribed, fold that into the category flag in the
      // same request instead of issuing a second PUT (H59, issue #626).
      if (
        !currentlySubscribed &&
        item.type &&
        preferenceFor(current, kindCategory(item.type))?.enabled !== true
      ) {
        const projected = withNotificationOverrides(current, updates);
        const kindItems = items.filter((candidate) => candidate.type === item.type);
        const allSubscribed = kindItems.every((candidate) =>
          isEntrySubscribedFrom(projected, candidate),
        );
        if (allSubscribed) {
          updates.push({ category: kindCategory(item.type), channel: CHANNEL, enabled: true });
        }
      }

      void haptic("selection");
      enqueueWrite(key, updates, () => Promise.resolve(toggleEntry(item)));
    },
    [enqueueWrite, items, prefs],
  );

  const toggleCategory = useCallback(
    (kind: string, enabled: boolean) => {
      const current = prefsRef.current ?? prefs;
      if (!current) return;
      const key = kindCategory(kind);
      const kindItems = items.filter((item) => item.type === kind);
      const preferences: NotificationPreferenceUpdate[] = [
        { category: key, channel: CHANNEL, enabled },
        // Clearing the muted (off) or stray individually-subscribed (on)
        // per-item rows keeps a later toggle starting from a clean slate.
        ...kindItems
          .filter((item) => preferenceFor(current, itemCategory(item.id)) !== undefined)
          .map((item) => ({ category: itemCategory(item.id), channel: CHANNEL, enabled })),
      ];
      void haptic("selection");
      enqueueWrite(key, preferences, () => Promise.resolve(toggleCategory(kind, enabled)));
    },
    [enqueueWrite, items, prefs],
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
