"use client";

import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { useCallback, useEffect } from "react";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

export function useScheduleLoader({
  canRead,
  t,
  setItems,
  setError,
  setSelectedIds,
  setEditingItem,
}: {
  canRead: boolean;
  t: Translate;
  setItems: React.Dispatch<React.SetStateAction<PublicScheduleItem[] | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  setEditingItem: React.Dispatch<React.SetStateAction<PublicScheduleItem | null>>;
}) {
  // Schedule edits reach the browser as the payload-free public invalidation;
  // the `content` topic itself carries staff notes and is not a subscribable scope.
  const liveRefresh = useAutoRefresh(canRead ? REALTIME_SCOPES.PUBLIC_CONTENT : "", [
    EVENTS.DATA_CHANGED,
  ]);

  const load = useCallback(
    (options?: { preserveSelection?: boolean }) => {
      setError(null);
      logisticsApi
        .schedule()
        .then(({ items }) => {
          setItems(items);
          if (options?.preserveSelection) {
            const currentIds = new Set(items.map((item) => item.id));
            setSelectedIds((selected) => new Set([...selected].filter((id) => currentIds.has(id))));
            setEditingItem((current) =>
              current ? (items.find((item) => item.id === current.id) ?? current) : null,
            );
          } else {
            setSelectedIds(new Set());
          }
        })
        .catch((err) => {
          setError(apiErrorText(err, t, t("couldNotLoadSchedule")));
        });
    },
    [t, setItems, setError, setSelectedIds, setEditingItem],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canRead) load({ preserveSelection: liveRefresh > 0 });
  }, [canRead, load, liveRefresh]);

  return load;
}
