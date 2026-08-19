import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import type { PresenceTimeline } from "@/components/presence-management";
import { apiFetch } from "@/lib/api";
import {
  detectPresenceDivergence,
  guaranteedMinutesTotal,
  type PresenceDivergence,
} from "@/lib/presence-timeline";

/**
 * Loads the presence timeline for the profile screen's register (H24): the
 * server's last door log (so the register can derive its direction from
 * ground truth) and the guaranteed-hours total shown under the register
 * buttons.
 */
export function usePresenceSummary({
  userId,
  refreshKey,
  onDoorState,
  onDivergence,
}: {
  userId: number;
  refreshKey?: string;
  /** Reports the server's last door log so the register can derive its direction from ground truth. */
  onDoorState?: (state: { kind: "in" | "out"; at: string } | null) => void;
  /** Reports when the door-only register's suggestion diverges from what activity signals show. */
  onDivergence?: (divergence: PresenceDivergence) => void;
}) {
  const [timeline, setTimeline] = useState<PresenceTimeline | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<PresenceTimeline>(`/api/presence/timeline/${userId}`);
      setTimeline(next);
      const lastDoor = [...next.signals].reverse().find((signal) => signal.source === "door");
      const doorState = lastDoor
        ? { kind: lastDoor.kind as "in" | "out", at: lastDoor.occurredAt }
        : null;
      onDoorState?.(doorState);
      onDivergence?.(
        detectPresenceDivergence(next.windows, doorState?.kind === "in" ? "out" : "in"),
      );
    } catch {
      // The dedicated presence subpage surfaces load errors with a retry;
      // this summary just falls back to a dash rather than duplicating that UI.
    }
  }, [onDoorState, onDivergence, userId]);

  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  // The profile screen stays mounted while "Add event" (a separate pushed
  // screen) saves a signal — reload on focus so returning here doesn't show
  // a stale guaranteed-hours stat or an already-resolved divergence.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return {
    timeline,
    guaranteedMinutes: guaranteedMinutesTotal(timeline?.windows ?? []),
  };
}
