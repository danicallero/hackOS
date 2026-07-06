"use client";

import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/env";

/**
 * SSE consumption for the queue/judging vertical (H38, H41-H42). The server
 * frames events per `packages/shared/src/events.ts`: each message is one
 * `SseEnvelope` ({ type, id, at, data }) with the envelope `type` as the SSE
 * event name. `EventSource` auto-reconnects and replays `Last-Event-ID`, so the
 * recovery contract is "on any event (and on reconnect) refetch the read model"
 * — the payload is a signal, not full state (see plan §4).
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
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const eventsKey = events ? events.join(",") : "";

  useEffect(() => {
    if (!enabled || !path) return;

    const source = new EventSource(`${API_URL}${path}`, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource retries on its own

    const handler = (e: MessageEvent) => {
      let envelope: SseEnvelope;
      try {
        envelope = JSON.parse(e.data);
      } catch {
        return; // ignore comments/heartbeats and malformed frames
      }
      onEventRef.current?.(envelope);
    };

    const names = eventsKey ? eventsKey.split(",") : null;
    if (names) {
      for (const name of names) source.addEventListener(name, handler as EventListener);
    } else {
      source.onmessage = handler;
    }

    return () => {
      if (names) {
        for (const name of names) source.removeEventListener(name, handler as EventListener);
      }
      source.close();
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
  { enabled = true, debounceMs = 150 }: { enabled?: boolean; debounceMs?: number } = {},
): { data: T | null; error: unknown; loading: boolean; connected: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const cancel = refetch();
    return cancel;
  }, [enabled, refetch]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEvent = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refetch, debounceMs);
  }, [refetch, debounceMs]);

  const { connected } = useEventSource(streamPath, { events: eventNames, onEvent, enabled });

  return { data, error, loading, connected, refetch };
}
