"use client";

import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "@/lib/env";
import {
  observeRefetch,
  type RealtimeRefetchTrigger,
  telemetryScopeForStream,
} from "@/lib/realtime-telemetry";
import { invalidateServerState, readServerState, type ServerStateKey } from "@/lib/server-state";
import { type SseResyncContext, type SseResyncReason, subscribeToSse } from "@/lib/sse-broker";

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

/** Keep live views usable when a browser suspends the tab or loses SSE. */
const FALLBACK_POLL_MS = 15_000;
const BACKGROUND_REVALIDATION_MS = 60_000;
const stableResourceKeys = new Map<string, ServerStateKey | undefined>();

function stableResourceKey(value: string): ServerStateKey | undefined {
  const cached = stableResourceKeys.get(value);
  if (cached !== undefined || stableResourceKeys.has(value)) return cached;
  const parsed = value === "null" ? undefined : (JSON.parse(value) as ServerStateKey);
  stableResourceKeys.set(value, parsed);
  return parsed;
}

interface UseEventSourceOptions {
  /** Event names to listen for; omit to catch every message via `onmessage`. */
  events?: readonly string[];
  /** Called for each matching envelope. Keep it stable or it re-subscribes. */
  onEvent?: (envelope: SseEnvelope) => void;
  /** Set false to not open the connection (e.g. before an id is known). */
  enabled?: boolean;
  /** Stable identity owning this stream; changes force the old stream closed. */
  identityKey?: string | number | null;
  /** Called when the lossy stream needs an authoritative read-model refetch. */
  onResync?: (context: SseResyncContext) => void;
}

/**
 * Open an SSE connection to `${API_URL}${path}` and dispatch envelopes by name.
 * Returns the live connection state for optional "reconnecting…" UI.
 */
export function useEventSource(
  path: string,
  { events, onEvent, enabled = true, identityKey = null, onResync }: UseEventSourceOptions = {},
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Keep the latest callback without forcing a resubscribe every render.
  // Assigned in useEffect to comply with react-hooks/rules-of-hooks.
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);
  const hasPreviousIdentityKey = useRef(false);
  const previousIdentityKey = useRef<string | number | null>(null);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const eventsKey = events ? events.join(",") : "";

  useEffect(() => {
    // SSR and lightweight component-test environments do not provide the
    // browser EventSource constructor. There is no stream to subscribe to in
    // either case; the next mounted browser session performs the normal sync.
    if (!enabled || !path || typeof EventSource === "undefined") return;

    const names = eventsKey ? eventsKey.split(",") : null;
    const unsubscribe = subscribeToSse(`${API_URL}${path}`, {
      events: names ?? undefined,
      onConnectionChange: setConnected,
      onEvent: (envelope) => onEventRef.current?.(envelope),
      onResync: (context) => onResyncRef.current?.(context),
      identityKey,
    });

    if (hasPreviousIdentityKey.current && previousIdentityKey.current !== identityKey) {
      onResyncRef.current?.({
        reason: "identity-change" satisfies SseResyncReason,
        topic: path,
        lastEventId: null,
      });
    }
    hasPreviousIdentityKey.current = true;
    previousIdentityKey.current = identityKey;

    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [path, enabled, eventsKey, identityKey]);

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
  fetcher: (signal?: AbortSignal) => Promise<T>,
  streamPath: string,
  eventNames: readonly string[] = Object.values(EVENTS),
  {
    enabled = true,
    debounceMs = 150,
    queryKey = [],
    resourceKey: requestedResourceKey,
    identityKey = null,
    onEvent: onMatchingEvent,
    onResync,
  }: {
    enabled?: boolean;
    debounceMs?: number;
    queryKey?: readonly unknown[];
    /** Identity-scoped shared read-model key. Omit for legacy local queries. */
    resourceKey?: ServerStateKey;
    identityKey?: string | number | null;
    /** Optional side effect for a matching event (for example an operational alert). */
    onEvent?: (event: SseEnvelope) => void;
    onResync?: (context: SseResyncContext) => void;
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
  const resourceKeyValue = JSON.stringify(requestedResourceKey ?? null);
  // The key is a value contract, so equal inline arrays must not restart a read.
  const resourceKey = stableResourceKey(resourceKeyValue);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const telemetryScope = useMemo(() => telemetryScopeForStream(streamPath), [streamPath]);
  const requestRef = useRef<{
    cancelled: boolean;
    queuedTrigger: RealtimeRefetchTrigger | null;
    trigger: RealtimeRefetchTrigger;
  } | null>(null);
  const disposedRef = useRef(false);
  const refetchRef = useRef<(trigger?: RealtimeRefetchTrigger) => void>(() => undefined);
  const dataRef = useRef<T | null>(null);

  const refetch = useCallback(
    (trigger: RealtimeRefetchTrigger = "manual") => {
      const current = requestRef.current;
      // Recovery reads must bypass the short-lived deduplication value: a
      // disconnected stream or resumed tab has no event to invalidate it.
      if (resourceKey && (trigger === "poll" || trigger === "visibility" || trigger === "retry")) {
        invalidateServerState(resourceKey);
        if (current) current.cancelled = true;
      }
      if (current) {
        // Keep one trailing read for events that arrived while the previous
        // request was in flight; an event burst must not fan out into N reads.
        current.queuedTrigger = trigger;
        return;
      }

      const request = {
        cancelled: false,
        queuedTrigger: null as RealtimeRefetchTrigger | null,
        trigger,
      };
      requestRef.current = request;
      observeRefetch(telemetryScope, trigger);

      (resourceKey
        ? readServerState(resourceKey, (signal) => fetcherRef.current(signal))
        : fetcherRef.current()
      )
        .then((d) => {
          if (!request.cancelled) {
            dataRef.current = d;
            setData(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (request.cancelled) return;
          // An already-rendered read model is better than replacing a live
          // screen with a transient error while SSE is recovering. Manual
          // retries still surface their failure so the user has a clear way
          // to act (H38, H41-H42).
          if (
            dataRef.current === null ||
            request.trigger === "manual" ||
            request.trigger === "retry"
          ) {
            setError(e);
          }
        })
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
    [telemetryScope, resourceKey],
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
      if (resourceKey) {
        invalidateServerState(resourceKey);
        // A fetch implementation may resolve despite AbortSignal (tests and
        // older wrappers sometimes do). Do not let that superseded payload
        // paint while the debounced authoritative read is queued.
        if (requestRef.current) requestRef.current.cancelled = true;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => refetch("sse"), debounceMs);
    },
    [refetch, debounceMs, resourceKey],
  );

  const onResyncRef = useRef(onResync);
  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const { connected } = useEventSource(streamPath, {
    events: eventNames,
    onEvent,
    enabled,
    identityKey,
    onResync: (context) => {
      onResyncRef.current?.(context);
      if (resourceKey) {
        invalidateServerState(resourceKey);
        if (requestRef.current) requestRef.current.cancelled = true;
      }
      refetch("sse");
    },
  });

  // Browser backgrounding can suspend EventSource without delivering an
  // event. Revalidate once after a meaningful hidden interval, even if the
  // browser still reports the stream as open (H38, H41-H42).
  const hiddenAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    if (document.visibilityState === "hidden" && hiddenAtRef.current === null) {
      hiddenAtRef.current = Date.now();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current ??= Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;

      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (
        hiddenAt !== null &&
        (Date.now() - hiddenAt >= BACKGROUND_REVALIDATION_MS || !connected)
      ) {
        refetch("visibility");
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [connected, enabled, refetch]);

  // Once the stream reports an error, use a bounded read-model poll until it
  // recovers. The timer is visible-tab-only, so a background tab does not
  // create a request burst when the OS throttles its timers (H38, H41-H42).
  useEffect(() => {
    if (!enabled || connected || typeof document === "undefined") return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch("poll");
    }, FALLBACK_POLL_MS);
    return () => window.clearInterval(poll);
  }, [connected, enabled, refetch]);

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
