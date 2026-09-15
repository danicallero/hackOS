import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { readCachedValue, writeCachedValue } from "./offline-cache";
import { useRetryOnReconnect } from "./use-retry-on-reconnect";

type Updater<T> = T | ((current: T | null) => T | null);
type CacheFetcher<T> = (signal?: AbortSignal) => Promise<T>;

/** A suspended app must revalidate before trusting a cached read model again. */
export const BACKGROUND_REVALIDATION_MS = 60_000;

export interface UseCachedApiOptions {
  /** Do not read, fetch, or expose account-owned data before identity is known. */
  enabled?: boolean;
  /** Optional safety poll for data normally refreshed by an event stream. */
  pollMs?: number;
  /** Set to 0 to opt out of the long-background revalidation. */
  backgroundRevalidationMs?: number;
}

/**
 * Keeps the last successful API payload on device. Cached data is only exposed
 * after a request fails, so online users never see a stale-data flash. Reads
 * revalidate quietly after a long app suspension; callers with an SSE-backed
 * view can also opt into a foreground safety poll.
 */
export function useCachedApi<T>(
  cacheKey: string,
  fetcher: CacheFetcher<T>,
  {
    enabled = true,
    pollMs = 0,
    backgroundRevalidationMs = BACKGROUND_REVALIDATION_MS,
  }: UseCachedApiOptions = {},
) {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const dataRef = useRef<T | null>(null);
  const updatedAtRef = useRef<string | null>(null);
  const requestId = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const inFlightCacheKey = useRef<string | null>(null);
  const inFlightController = useRef<AbortController | null>(null);
  const dataCacheKey = useRef<string | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const awaySinceRef = useRef<number | null>(
    AppState.currentState === "active" ? null : Date.now(),
  );

  const setData = useCallback(
    (updater: Updater<T>, persist = true) => {
      if (!enabled) return;
      const current = dataCacheKey.current === cacheKey ? dataRef.current : null;
      const next =
        typeof updater === "function"
          ? (updater as (current: T | null) => T | null)(current)
          : updater;
      dataRef.current = next;
      dataCacheKey.current = cacheKey;
      setDataState(next);
      if (persist && next !== null) {
        const updatedAt = new Date().toISOString();
        updatedAtRef.current = updatedAt;
        void writeCachedValue(cacheKey, next, updatedAt);
      }
    },
    [cacheKey, enabled],
  );

  const load = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    if (inFlight.current && inFlightCacheKey.current === cacheKey) return inFlight.current;

    if (inFlight.current && inFlightCacheKey.current !== cacheKey) {
      inFlightController.current?.abort();
    }
    const currentRequest = ++requestId.current;
    const controller = new AbortController();
    inFlightController.current = controller;
    // Background recovery and safety polling must not replace a rendered
    // read model with a loading state while the request is in flight.
    if (dataCacheKey.current !== cacheKey || dataRef.current === null) setLoading(true);
    const request = (async () => {
      setError(null);
      try {
        const next = await fetcher(controller.signal);
        if (currentRequest !== requestId.current) return;
        const updatedAt = new Date().toISOString();
        dataRef.current = next;
        dataCacheKey.current = cacheKey;
        updatedAtRef.current = updatedAt;
        setDataState(next);
        setStaleSince(null);
        await writeCachedValue(cacheKey, next, updatedAt);
      } catch (cause) {
        if (currentRequest !== requestId.current) return;
        const cached = await readCachedValue<T>(cacheKey);
        if (currentRequest !== requestId.current) return;
        if (cached) {
          dataRef.current = cached.data;
          dataCacheKey.current = cacheKey;
          updatedAtRef.current = cached.updatedAt;
          setDataState(cached.data);
          setStaleSince(cached.updatedAt);
        } else if (dataCacheKey.current !== cacheKey || dataRef.current === null) {
          setError(cause instanceof Error ? cause : new Error("Failed to load data"));
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    })().finally(() => {
      if (inFlight.current !== request) return;
      inFlight.current = null;
      inFlightCacheKey.current = null;
      inFlightController.current = null;
    });
    inFlight.current = request;
    inFlightCacheKey.current = cacheKey;
    return request;
  }, [cacheKey, enabled, fetcher]);

  useEffect(() => {
    if (enabled) return;
    requestId.current += 1;
    inFlightController.current?.abort();
    inFlightController.current = null;
    inFlight.current = null;
    inFlightCacheKey.current = null;
    dataRef.current = null;
    dataCacheKey.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- account gate must clear sensitive data immediately.
    setDataState(null);
    setStaleSince(null);
    setError(null);
    setLoading(false);
  }, [enabled]);

  // AppState can move directly from background to active, or pass through
  // iOS's short inactive state. Only a meaningful interruption triggers a
  // quiet foreground read, so Control Center does not cause a refresh flash.
  useEffect(() => {
    if (!enabled || backgroundRevalidationMs <= 0) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        awaySinceRef.current ??= Date.now();
      } else if (appStateRef.current !== "active") {
        const wasAwayLongEnough =
          awaySinceRef.current !== null &&
          Date.now() - awaySinceRef.current >= backgroundRevalidationMs;
        awaySinceRef.current = null;
        if (wasAwayLongEnough) void load();
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, [backgroundRevalidationMs, enabled, load]);

  // A stream reconnect is event-driven, but a failed stream can otherwise
  // leave its last successful cache in place indefinitely. Poll only while
  // the app is active; the foreground handler above covers suspension.
  useEffect(() => {
    if (!enabled || pollMs <= 0) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void load();
    }, pollMs);
    return () => clearInterval(interval);
  }, [enabled, load, pollMs]);

  // A hard error (no cache to fall back to) recovers on its own once
  // connectivity returns, instead of leaving the screen stuck behind a
  // manual Retry tap.
  useRetryOnReconnect(enabled && error !== null, load);

  return {
    data: enabled && dataCacheKey.current === cacheKey ? data : null,
    error: enabled ? error : null,
    loading: enabled ? loading : false,
    staleSince: enabled && dataCacheKey.current === cacheKey ? staleSince : null,
    load,
    setData,
  };
}
