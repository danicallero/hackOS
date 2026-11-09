import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { startDomainEventStream, subscribeToServerEvent } from "@/lib/server-events";

/**
 * Only server-confirmed values are displayed. Focus, push and pull refreshes
 * revalidate in place: the last response stays on screen (no blank flash, no
 * lost scroll or draft) and an identical response does not re-render. Only a
 * different `path` starts from an empty state.
 */
export type HelpResource<T> = ReturnType<typeof useHelpResource<T>>;

export function useHelpResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Loading from the first frame, so a screen never flashes an empty state before its first answer.
  const [loading, setLoading] = useState(path !== null);
  const generation = useRef(0);
  const shown = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      // A stalled request ends in the retryable error state instead of an endless spinner.
      const result = await apiFetch<T>(path, { signal: AbortSignal.timeout(20_000) });
      if (generation.current !== current) return;
      const serialized = JSON.stringify(result);
      if (serialized !== shown.current) {
        shown.current = serialized;
        setData(result);
      }
      setError(null);
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    shown.current = null;
    setData(null);
    setError(null);
    setLoading(path !== null);
  }, [path]);
  const replace = useCallback((next: T | null | ((current: T | null) => T | null)) => {
    setData((current) => {
      const value =
        typeof next === "function" ? (next as (c: T | null) => T | null)(current) : next;
      shown.current = value === null ? null : JSON.stringify(value);
      return value;
    });
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      const stop = subscribeToNotificationChanges(() => void load());
      const stopDomain = path
        ? startDomainEventStream(SSE_TOPICS.HELPDESK, { onResync: () => void load() })
        : () => {};
      const stopChange = subscribeToServerEvent(
        EVENTS.DOMAIN_CHANGED,
        () => void load(),
        domainScope(SSE_TOPICS.HELPDESK),
      );
      const stopPersonal = subscribeToServerEvent(
        EVENTS.HELPDESK_REQUEST_CHANGED,
        () => void load(),
      );
      return () => {
        generation.current++;
        stop();
        stopDomain();
        stopChange();
        stopPersonal();
      };
    }, [load, path]),
  );
  return { data, error, loading, load, setData: replace };
}
