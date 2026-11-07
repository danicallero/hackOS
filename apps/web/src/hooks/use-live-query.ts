"use client";

import type { SseEnvelope } from "@hackos/shared/events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNotFoundError } from "@/lib/api";
import {
  observeRefetch,
  type RealtimeRefetchTrigger,
  telemetryScopeForRealtimeScope,
} from "@/lib/realtime-telemetry";
import {
  invalidateServerState,
  peekServerState,
  readServerState,
  type ServerStateKey,
} from "@/lib/server-state";
import type { SseResyncContext } from "@/lib/sse-broker";
import { useEventSource } from "./use-event-source";

/** Keep live views usable when a browser suspends the tab or loses SSE. */
const FALLBACK_POLL_MS = 15_000;
const BACKGROUND_REVALIDATION_MS = 60_000;
/** Stale-data retry backoff: 5 s, doubling to a 60 s ceiling (#1012). */
const STALE_BASE_DELAY_MS = 5_000;
const STALE_MAX_DELAY_MS = 60_000;
const stableResourceKeys = new Map<string, ServerStateKey | undefined>();

function stableResourceKey(value: string): ServerStateKey | undefined {
  const cached = stableResourceKeys.get(value);
  if (cached !== undefined || stableResourceKeys.has(value)) return cached;
  const parsed = value === "null" ? undefined : (JSON.parse(value) as ServerStateKey);
  stableResourceKeys.set(value, parsed);
  return parsed;
}

/**
 * The common pattern (plan §4): fetch a read model on mount, then debounce-
 * refetch whenever a relevant event arrives on `scope`. Returns the data,
 * a manual `refetch`, loading/error, and live connection state.
 *
 * Failure policy (#1012): a failed first read sets `error`. A failed refetch
 * after data was painted keeps the data, flips `stale` on and retries with
 * exponential backoff until a read succeeds; render `StaleDataNotice` from
 * `stale`. A 404 is definitive and always sets `error`, even over data. A
 * caller's own `refetch()` failing over data also sets `error` (H38, H41-H42),
 * so pages that want the quiet policy show `error` only when `data` is null
 * or `isNotFoundError(error)`.
 *
 *   const { data } = useLiveQuery(
 *     () => getRoomView(roomId),
 *     REALTIME_SCOPES.QUEUE,
 *     [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
 *     { resourceKey: ["queue", "room-view", roomId] },
 *   );
 */
export function useLiveQuery<T>(
  fetcher: (signal?: AbortSignal) => Promise<T>,
  scope: string,
  eventNames: readonly string[],
  {
    enabled = true,
    debounceMs = 150,
    jitterMs,
    queryKey = [],
    resourceKey: requestedResourceKey,
    identityKey = null,
    onEvent: onMatchingEvent,
    onResync,
  }: {
    enabled?: boolean;
    debounceMs?: number;
    /** Random delay in `[0, jitterMs)` instead of `debounceMs`, to spread public-surface refetches. */
    jitterMs?: number;
    queryKey?: readonly unknown[];
    /** Identity-scoped shared read-model key; include every parameter the fetcher uses. */
    resourceKey: ServerStateKey;
    identityKey?: string | number | null;
    /** Optional side effect for a matching event (for example an operational alert). */
    onEvent?: (event: SseEnvelope) => void;
    onResync?: (context: SseResyncContext) => void;
  },
): {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** True while the painted `data` is older than the last failed refetch. */
  stale: boolean;
  connected: boolean;
  refetch: (trigger?: RealtimeRefetchTrigger) => void;
} {
  const resourceKeyValue = JSON.stringify(requestedResourceKey);
  // The key is a value contract, so equal inline arrays must not restart a read.
  const resourceKey = stableResourceKey(resourceKeyValue) as ServerStateKey;
  // Stale-while-revalidate: a remount paints the last settled read model at
  // once; the mount effect below still revalidates it in the background.
  const [data, setData] = useState<T | null>(() =>
    enabled ? (peekServerState<T>(resourceKey) ?? null) : null,
  );
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(data === null);
  const [stale, setStale] = useState(false);
  const staleAttemptsRef = useRef(0);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const telemetryScope = useMemo(() => telemetryScopeForRealtimeScope(scope), [scope]);
  const requestRef = useRef<{
    cancelled: boolean;
    queuedTrigger: RealtimeRefetchTrigger | null;
    trigger: RealtimeRefetchTrigger;
  } | null>(null);
  const disposedRef = useRef(false);
  const refetchRef = useRef<(trigger?: RealtimeRefetchTrigger) => void>(() => undefined);
  const dataRef = useRef<T | null>(data);

  const refetch = useCallback(
    (trigger: RealtimeRefetchTrigger = "manual") => {
      const current = requestRef.current;
      // Recovery reads must bypass the short-lived deduplication value: a
      // disconnected stream or resumed tab has no event to invalidate it.
      if (trigger === "poll" || trigger === "visibility" || trigger === "retry") {
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

      readServerState(resourceKey, (signal) => fetcherRef.current(signal))
        .then((d) => {
          if (!request.cancelled) {
            dataRef.current = d;
            setData(d);
            setError(null);
            staleAttemptsRef.current = 0;
            if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
            staleTimerRef.current = null;
            setStale(false);
          }
        })
        .catch((e) => {
          if (request.cancelled) return;
          // An already-rendered read model is better than replacing a live
          // screen with a transient error while SSE is recovering. Manual
          // retries still surface their failure so the user has a clear way
          // to act (H38, H41-H42).
          const keepsData = dataRef.current !== null && !isNotFoundError(e);
          if (!keepsData || request.trigger === "manual" || request.trigger === "retry") {
            setError(e);
          }
          if (keepsData) {
            setStale(true);
            if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
            const delay = Math.min(
              STALE_BASE_DELAY_MS * 2 ** staleAttemptsRef.current,
              STALE_MAX_DELAY_MS,
            );
            staleAttemptsRef.current += 1;
            // A silent "poll" read: it bypasses the shared value without
            // surfacing its own failure over the painted data.
            staleTimerRef.current = setTimeout(() => {
              staleTimerRef.current = null;
              refetchRef.current("poll");
            }, delay);
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
    // A new resource starts with a clean failure history.
    staleAttemptsRef.current = 0;
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new key must not inherit the previous key's stale flag
    setStale(false);
    if (!enabled) return;
    const settled = peekServerState<T>(resourceKey);
    if (settled !== undefined) {
      dataRef.current = settled;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the cached read model of a new key before revalidating it
      setData(settled);
      setLoading(false);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading on refetch; no lazier pattern for this state reset
      setLoading(true);
    }
    const cancel = refetch();
    return cancel;
  }, [enabled, refetch, queryKeyValue, resourceKey]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMatchingEventRef = useRef(onMatchingEvent);
  const onResyncRef = useRef(onResync);
  useEffect(() => {
    onMatchingEventRef.current = onMatchingEvent;
    onResyncRef.current = onResync;
  }, [onMatchingEvent, onResync]);

  const scheduleRefetch = useCallback(() => {
    invalidateServerState(resourceKey);
    // A fetch implementation may resolve despite AbortSignal (tests and
    // older wrappers sometimes do). Do not let that superseded payload
    // paint while the debounced authoritative read is queued.
    if (requestRef.current) requestRef.current.cancelled = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => refetch("sse"),
      jitterMs === undefined ? debounceMs : Math.random() * jitterMs,
    );
  }, [refetch, debounceMs, jitterMs, resourceKey]);

  const onEvent = useCallback(
    (event: SseEnvelope) => {
      onMatchingEventRef.current?.(event);
      scheduleRefetch();
    },
    [scheduleRefetch],
  );

  const { connected } = useEventSource(scope, {
    events: eventNames,
    onEvent,
    enabled,
    identityKey,
    onResync: (context) => {
      onResyncRef.current?.(context);
      scheduleRefetch();
    },
  });

  // Browser backgrounding can suspend SSE without delivering an
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
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      if (requestRef.current) requestRef.current.cancelled = true;
    },
    [],
  );

  // A caller's own refetch follows a local mutation or retry: no SSE event
  // invalidated the shared value, so drop it before reading.
  const refetchFresh = useCallback(
    (trigger: RealtimeRefetchTrigger = "manual") => {
      if (trigger === "manual") {
        invalidateServerState(resourceKey);
        if (requestRef.current) requestRef.current.cancelled = true;
      }
      refetch(trigger);
    },
    [refetch, resourceKey],
  );

  return { data, error, loading, stale, connected, refetch: refetchFresh };
}
