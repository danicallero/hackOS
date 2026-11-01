import { useEffect, useRef } from "react";
import { haptic } from "./haptics";
import { queueBatchIntent } from "./scan-haptics";
import type { PendingScan } from "./scanner-types";

/**
 * #1170: gives the offline queue a haptic when an entry is confirmed, rejected
 * or put back for retry while the operator is watching the queue. The first
 * snapshot only seeds the comparison, so opening the screen is silent.
 */
export function useQueueTransitionHaptics(queue: ReadonlyArray<PendingScan>): void {
  const previous = useRef<ReadonlyArray<PendingScan> | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = queue;
    if (!before) return;
    const intent = queueBatchIntent(before, queue);
    if (intent) void haptic(intent);
  }, [queue]);
}
