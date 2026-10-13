"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  invalidateServerState,
  readServerState,
  type ServerStateKey,
  serverStateEpoch,
  subscribeServerStateEpoch,
  subscribeServerStateWrites,
  writeServerState,
} from "@/lib/server-state";

type Result<T> = { stamp: string; data: T | null; error: unknown };

/**
 * One GET through the identity-scoped `server-state` primitive (#720, #1003):
 * concurrent readers of a key share one request, and an identity switch drops
 * the data and re-reads. Failures surface as `error`; nothing is substituted.
 * Use `useLiveQuery` instead when SSE events should refresh the resource.
 */
export function useServerResource<T>(
  key: ServerStateKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
  { enabled = true }: { enabled?: boolean } = {},
): {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Force a fresh read. */
  reload: () => void;
  /** Store data a mutation already returned, for every reader of the key. */
  mutate: (data: T) => void;
} {
  const epoch = useSyncExternalStore(subscribeServerStateEpoch, serverStateEpoch, () => 0);
  const keyValue = JSON.stringify(key);
  const stamp = `${epoch}:${keyValue}`;
  const [result, setResult] = useState<Result<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  const keyRef = useRef(key);
  useEffect(() => {
    fetcherRef.current = fetcher;
    keyRef.current = key;
  }, [fetcher, key]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyValue stands for the key's value; nonce is the reload trigger.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readServerState(keyRef.current, (signal) => fetcherRef.current(signal)).then(
      (data) => {
        if (!cancelled) setResult({ stamp, data, error: null });
      },
      (error) => {
        if (cancelled) return;
        setResult((prev) => ({
          stamp,
          data: prev?.stamp === stamp ? prev.data : null,
          error,
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [stamp, enabled, nonce]);

  // Another reader's mutation result is this key's newest data.
  useEffect(
    () =>
      subscribeServerStateWrites((written, data) => {
        if (written === keyValue) setResult({ stamp, data: data as T, error: null });
      }),
    [keyValue, stamp],
  );

  const reload = useCallback(() => {
    invalidateServerState(keyRef.current);
    setNonce((n) => n + 1);
  }, []);

  const mutate = useCallback((data: T) => {
    writeServerState(keyRef.current, data);
    setResult({
      stamp: `${serverStateEpoch()}:${JSON.stringify(keyRef.current)}`,
      data,
      error: null,
    });
  }, []);

  const current = result?.stamp === stamp ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && current === null,
    reload,
    mutate,
  };
}
