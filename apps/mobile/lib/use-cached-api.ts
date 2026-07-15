import { useCallback, useRef, useState } from "react";

import { readCachedValue, writeCachedValue } from "./offline-cache";

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
    setError(null);
    try {
      const next = await fetcher();
      const updatedAt = new Date().toISOString();
      dataRef.current = next;
      updatedAtRef.current = updatedAt;
      setDataState(next);
      setStaleSince(null);
      await writeCachedValue(cacheKey, next, updatedAt);
    } catch (cause) {
      const cached = await readCachedValue<T>(cacheKey);
      if (cached) {
        dataRef.current = cached.data;
        updatedAtRef.current = cached.updatedAt;
        setDataState(cached.data);
        setStaleSince(cached.updatedAt);
      } else {
        setError(cause instanceof Error ? cause : new Error("Failed to load data"));
      }
    } finally {
      setLoading(false);
    }
  }, [cacheKey, fetcher]);

  return { data, error, loading, staleSince, load, setData };
}
