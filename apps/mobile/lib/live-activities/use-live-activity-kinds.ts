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
 * choice, for the kinds their account receives. Saved per account; a toggle
 * is optimistic, then re-syncs this device so a kind turned off ends here at
 * once (the worker ends it on the other devices).
 */
export function useLiveActivityKinds(active: boolean) {
  const [kinds, setKinds] = useState<KindPreference[] | null>(null);
  const [busyKind, setBusyKind] = useState<LiveActivityConfigKind | null>(null);
  /** Only the latest toggle's response may replace the list. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const seq = latest.current;
    try {
      const response = await apiFetch<MyLiveActivityPreferences>(PATH);
      if (seq === latest.current) setKinds(response.kinds);
    } catch {
      // Without the list the per-kind rows stay hidden; pull to refresh retries.
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const toggle = useCallback(async (kind: LiveActivityConfigKind, enabled: boolean) => {
    const seq = ++latest.current;
    const set = (value: boolean) =>
      setKinds(
        (current) =>
          current?.map((item) => (item.kind === kind ? { ...item, enabled: value } : item)) ?? null,
      );
    set(enabled);
    setBusyKind(kind);
    try {
      const response = await apiFetch<MyLiveActivityPreferences>(PATH, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kinds: [{ kind, enabled }] }),
      });
      if (seq === latest.current) setKinds(response.kinds);
      await reconcileLiveActivities().catch(() => undefined);
    } catch {
      set(!enabled);
    } finally {
      if (seq === latest.current) setBusyKind(null);
    }
  }, []);

  return { kinds: active ? (kinds ?? []) : [], busyKind, toggle, load };
}
