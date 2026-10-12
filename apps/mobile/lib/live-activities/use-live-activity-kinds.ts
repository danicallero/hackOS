import type {
  LiveActivityConfigKind,
  MyLiveActivityPreferences,
} from "@hackos/shared/live-activities";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { reconcileLiveActivities } from "./sync";

const PATH = "/api/me/live-activities/preferences";

type KindPreference = MyLiveActivityPreferences["kinds"][number];

/**
 * #966 (H38, H25, H59, H19, H22): the caller's per-kind Live Activity
 * choice and kind order, for the kinds their account receives. Saved per
 * account; a change is optimistic, then re-syncs this device so a kind
 * turned off (or outranked) ends here at once (the worker ends it on the
 * other devices).
 */
export function useLiveActivityKinds(active: boolean) {
  const [state, setStateValue] = useState<MyLiveActivityPreferences | null>(null);
  /** The rendered state, so a failed save can restore what preceded it. */
  const snapshot = useRef<MyLiveActivityPreferences | null>(null);
  const setState = useCallback((next: MyLiveActivityPreferences | null) => {
    snapshot.current = next;
    setStateValue(next);
  }, []);
  const [busyKind, setBusyKind] = useState<LiveActivityConfigKind | null>(null);
  const [ordering, setOrdering] = useState(false);
  /** Only the latest change's response may replace the list. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const seq = latest.current;
    try {
      const response = await apiFetch<MyLiveActivityPreferences>(PATH);
      if (seq === latest.current) setState(response);
    } catch {
      // Without the list the per-kind rows stay hidden; pull to refresh retries.
    }
  }, [setState]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  /**
   * Applies `optimistic` now, PUTs `body`, and restores the previous state on
   * failure. The latest change also clears the pending markers.
   */
  const save = useCallback(
    async (
      body: { kinds: KindPreference[] } | { order: LiveActivityConfigKind[] | null },
      optimistic: (prefs: MyLiveActivityPreferences) => MyLiveActivityPreferences,
    ) => {
      const seq = ++latest.current;
      const previous = snapshot.current;
      if (previous) setState(optimistic(previous));
      try {
        const response = await apiFetch<MyLiveActivityPreferences>(PATH, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (seq === latest.current) setState(response);
        await reconcileLiveActivities().catch(() => undefined);
      } catch {
        if (seq === latest.current) setState(previous);
      } finally {
        if (seq === latest.current) {
          setBusyKind(null);
          setOrdering(false);
        }
      }
    },
    [setState],
  );

  const toggle = useCallback(
    async (kind: LiveActivityConfigKind, enabled: boolean) => {
      setBusyKind(kind);
      await save({ kinds: [{ kind, enabled }] }, (prefs) => ({
        ...prefs,
        kinds: prefs.kinds.map((item) => (item.kind === kind ? { ...item, enabled } : item)),
      }));
    },
    [save],
  );

  /** Saves `order` (every listed kind, highest priority first). */
  const reorder = useCallback(
    async (order: LiveActivityConfigKind[]) => {
      setOrdering(true);
      await save({ order }, (prefs) => ({
        customOrder: true,
        kinds: order
          .map((kind) => prefs.kinds.find((item) => item.kind === kind))
          .filter((item): item is KindPreference => item !== undefined),
      }));
    },
    [save],
  );

  /** Back to the organizer order; the response carries it. */
  const resetOrder = useCallback(async () => {
    setOrdering(true);
    await save({ order: null }, (prefs) => prefs);
  }, [save]);

  return {
    kinds: active ? (state?.kinds ?? []) : [],
    customOrder: active && state?.customOrder === true,
    busyKind,
    ordering,
    toggle,
    reorder,
    resetOrder,
    load,
  };
}
