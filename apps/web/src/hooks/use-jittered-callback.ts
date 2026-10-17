"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a stable function that runs `callback` once after a random delay in
 * `[0, maxDelayMs)`; calls made while one is pending coalesce into it. Public
 * surfaces use it after a payload-free SSE signal, so thousands of clients
 * refetch spread over a window and the server's shared cache answers all but
 * the first from memory instead of the database.
 */
export function useJitteredCallback(callback: () => void, maxDelayMs: number): () => void {
  const latest = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, Math.random() * maxDelayMs);
  }, [maxDelayMs]);
}
