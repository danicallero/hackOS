"use client";

import { useEffect, useRef, useState } from "react";

interface DebouncedSearchOptions {
  /** Search only while true (typically: the picker is open). */
  enabled?: boolean;
  delayMs?: number;
  /** Trimmed queries shorter than this are not searched. */
  minLength?: number;
  /** Change it to repeat an unchanged query (a retry button). */
  retryKey?: number;
}

/**
 * Debounced remote search for pickers. The latest `fetcher` runs once the
 * query settled; a superseded or unmounted search is aborted and its answer
 * dropped. The previous result stays visible while the next one loads, and a
 * failure is reported as `error` rather than substituted by an empty list.
 */
export function useDebouncedSearch<T>(
  query: string,
  fetcher: (query: string, signal: AbortSignal) => Promise<T>,
  { enabled = true, delayMs = 250, minLength = 0, retryKey = 0 }: DebouncedSearchOptions = {},
): { result: T | null; loading: boolean; error: boolean } {
  const [state, setState] = useState<{ result: T | null; loading: boolean; error: boolean }>({
    result: null,
    loading: false,
    error: false,
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const trimmed = query.trim();
  const searchable = enabled && trimmed.length >= minLength;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey intentionally repeats an unchanged query.
  useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: false }));
      try {
        const result = await fetcherRef.current(trimmed, controller.signal);
        if (!controller.signal.aborted) setState({ result, loading: false, error: false });
      } catch {
        if (!controller.signal.aborted) setState({ result: null, loading: false, error: true });
      }
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchable, trimmed, delayMs, retryKey]);

  return state;
}
