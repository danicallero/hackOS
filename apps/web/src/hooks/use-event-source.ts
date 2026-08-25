"use client";

import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/env";
import {
  observeRefetch,
  type RealtimeRefetchTrigger,
  telemetryScopeForStream,
} from "@/lib/realtime-telemetry";
import { subscribeToSse } from "@/lib/sse-broker";

/**
 * SSE consumption for the queue/judging vertical (H38, H41-H42). The server
 * frames events per `packages/shared/src/events.ts`: each message is one
 * `SseEnvelope` ({ type, id, at, data }) with the envelope `type` as the SSE
 * event name. Clients refetch their read model on matching server events; the
 * payload is a signal, not full state (see plan §4).
 *
 * `EventSource` can't set headers; the queue/tv streams are cookie-auth or
 * public, so `withCredentials` carries the session cookie.
 */

export type SseEnvelope<T = unknown> = { type: string; id: string; at: string; data: T };

interface UseEventSourceOptions {
  /** Event names to listen for; omit to catch every message via `onmessage`. */
  events?: readonly string[];
  /** Called for each matching envelope. Keep it stable or it re-subscribes. */
  onEvent?: (envelope: SseEnvelope) => void;
  /** Set false to not open the connection (e.g. before an id is known). */
  enabled?: boolean;
}

/**
 * Open an SSE connection to `${API_URL}${path}` and dispatch envelopes by name.
 * Returns the live connection state for optional "reconnecting…" UI.
 */
export function useEventSource(
  path: string,
  { events, onEvent, enabled = true }: UseEventSourceOptions = {},
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Keep the latest callback without forcing a resubscribe every render.
  // Assigned in useEffect to comply with react-hooks/rules-of-hooks.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const eventsKey = events ? events.join(",") : "";

  useEffect(() => {
    if (!enabled || !path) return;

    const names = eventsKey ? eventsKey.split(",") : null;
    const unsubscribe = subscribeToSse(`${API_URL}${path}`, {
      events: names ?? undefined,
      onConnectionChange: setConnected,
      onEvent: (envelope) => onEventRef.current?.(envelope),
    });

    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [path, enabled, eventsKey]);

  return { connected };
}

/**
 * The common pattern (plan §4): fetch a read model on mount, then debounce-
 * refetch whenever a relevant event arrives on `streamPath`. Returns the data,
 * a manual `refetch`, loading/error, and live connection state.
 *
 *   const { data } = useLiveQuery(
 *     () => getRoomView(roomId),
 *     "/api/queue/stream",
 *     [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
 *   );
 */
export function useLiveQuery<T>(
  fetcher: () => Promise<T>,
  streamPath: string,
  eventNames: readonly string[] = Object.values(EVENTS),
  {
    enabled = true,
    debounceMs = 150,
    queryKey = [],
    onEvent: onMatchingEvent,
  }: {
    enabled?: boolean;
    debounceMs?: number;
    queryKey?: readonly unknown[];
    /** Optional side effect for a matching event (for example an operational alert). */
    onEvent?: (event: SseEnvelope) => void;
  } = {},
): {
  data: T | null;
  error: unknown;
  loading: boolean;
  connected: boolean;
  refetch: (trigger?: RealtimeRefetchTrigger) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const telemetryScope = useMemo(() => telemetryScopeForStream(streamPath), [streamPath]);
  const requestRef = useRef<{
    cancelled: boolean;
    queuedTrigger: RealtimeRefetchTrigger | null;
  } | null>(null);
  const disposedRef = useRef(false);
  const refetchRef = useRef<(trigger?: RealtimeRefetchTrigger) => void>(() => undefined);

  const refetch = useCallback(
    (trigger: RealtimeRefetchTrigger = "manual") => {
      const current = requestRef.current;
      if (current) {
        // Keep one trailing read for events that arrived while the previous
        // request was in flight; an event burst must not fan out into N reads.
        current.queuedTrigger = trigger;
        return;
      }

      const request = { cancelled: false, queuedTrigger: null as RealtimeRefetchTrigger | null };
      requestRef.current = request;
      observeRefetch(telemetryScope, trigger);

      fetcherRef
        .current()
        .then((d) => {
          if (!request.cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => !request.cancelled && setError(e))
        .finally(() => {
          if (!request.cancelled) setLoading(false);
          if (requestRef.current !== request) return;
          requestRef.current = null;
          if (!disposedRef.current && request.queuedTrigger) {
            refetchRef.current(request.queuedTrigger);
          }
        });

      return () => {
        request.cancelled = true;
      };
    },
    [telemetryScope],
  );

  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const queryKeyValue = JSON.stringify(queryKey);

  // biome-ignore lint/correctness/useExhaustiveDependencies: queryKeyValue intentionally refetches when caller scope changes.
  useEffect(() => {
    disposedRef.current = false;
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading on refetch; no lazier pattern for this state reset
    setLoading(true);
    const cancel = refetch();
    return cancel;
  }, [enabled, refetch, queryKeyValue]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMatchingEventRef = useRef(onMatchingEvent);
  useEffect(() => {
    onMatchingEventRef.current = onMatchingEvent;
  }, [onMatchingEvent]);
  const onEvent = useCallback(
    (event: SseEnvelope) => {
      onMatchingEventRef.current?.(event);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => refetch("sse"), debounceMs);
    },
    [refetch, debounceMs],
  );

  const { connected } = useEventSource(streamPath, { events: eventNames, onEvent, enabled });

  useEffect(
    () => () => {
      disposedRef.current = true;
      if (timer.current) clearTimeout(timer.current);
      if (requestRef.current) requestRef.current.cancelled = true;
    },
    [],
  );

  return { data, error, loading, connected, refetch };
}
