"use client";

import { useEffect, useRef } from "react";
import { useEventSource } from "./use-event-source";

/** Coalesces a burst of near-simultaneous domain events into one reload. */
const LIVE_RELOAD_DEBOUNCE_MS = 200;

/**
 * Soft, in-place refresh for a view that owns its own loader (form state it
 * must not clobber, a partially optimistic list). Calls `reload` once per
 * debounced burst of matching SSE events on `scope`; there is no nonce to
 * thread through an effect. Pass `enabled: false` (or an empty `scope`) to
 * pause. Prefer `useLiveQuery` when the page can simply render a read model.
 */
export function useLiveReload(
  scope: string,
  events: readonly string[],
  reload: () => void,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const reloadRef = useRef(reload);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useEventSource(scope, {
    events,
    enabled,
    onEvent: () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        reloadRef.current();
      }, LIVE_RELOAD_DEBOUNCE_MS);
    },
  });
}
