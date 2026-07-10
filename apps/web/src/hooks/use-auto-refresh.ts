"use client";

import { useRef, useState } from "react";
import { useEventSource } from "./use-event-source";

/**
 * Soft, in-place refresh instead of a hard `window.location.reload()` — the
 * pattern already used by /tv and /my-queue, generalized. Bumps a nonce
 * whenever a relevant SSE event fires (debounced, to coalesce a burst of
 * near-simultaneous domain events into one refetch). Add the returned nonce
 * to an existing data-loading effect's dependency array to make that effect
 * refetch live, without needing to extract it into a standalone callback.
 */
export function useAutoRefresh(stream: string, events: string[]): number {
  const [nonce, setNonce] = useState(0);
  const timer = useRef<number | null>(null);

  useEventSource(stream, {
    events,
    onEvent: () => {
      if (timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setNonce((n) => n + 1);
      }, 200);
    },
  });

  return nonce;
}
