import { useCallback, useRef, useState } from "react";

import { readCachedValue, writeCachedValue } from "./offline-cache";
import { useRetryOnReconnect } from "./use-retry-on-reconnect";

type Updater<T> = T | ((current: T | null) => T | null);

/**
 * Keeps the last successful API payload on device. Cached data is only exposed
 * after a request fails, so online users never see a stale-data flash.
 */
export function useCachedApi<T>(cacheKey: string, fetcher: () => Promise<T>) {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const dataRef = useRef<T | null>(null);
  const updatedAtRef = useRef<string | null>(null);
  const requestId = useRef(0);

  const setData = useCallback(
    (updater: Updater<T>, persist = true) => {
      const next =
        typeof updater === "function"
          ? (updater as (current: T | null) => T | null)(dataRef.current)
          : updater;
      dataRef.current = next;
      setDataState(next);
      if (persist && next !== null) {
        const updatedAt = new Date().toISOString();
        updatedAtRef.current = updatedAt;
        void writeCachedValue(cacheKey, next, updatedAt);
      }
    },
    [cacheKey],
  );

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetcher();
      if (currentRequest !== requestId.current) return;
      const updatedAt = new Date().toISOString();
      dataRef.current = next;
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
        updatedAtRef.current = cached.updatedAt;
        setDataState(cached.data);
        setStaleSince(cached.updatedAt);
      } else {
        setError(cause instanceof Error ? cause : new Error("Failed to load data"));
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [cacheKey, fetcher]);

  // A hard error (no cache to fall back to) recovers on its own once
  // connectivity returns, instead of leaving the screen stuck behind a
  // manual Retry tap.
  useRetryOnReconnect(error !== null, load);

  return { data, error, loading, staleSince, load, setData };
}
