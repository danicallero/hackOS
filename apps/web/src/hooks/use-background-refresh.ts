"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 60_000;

/** True only for a definitive "does not exist" answer, never 429/5xx/network. */
export function isNotFoundError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/**
 * Failure policy for a page's `load()` that is re-run by `useAutoRefresh`.
 * A failure before anything loaded is a first-load failure: the caller shows
 * its error state. A failure after data has loaded is a background failure:
 * the caller keeps its data and selections, `stale` flips on, and `reload`
 * is retried with exponential backoff by bumping `retryNonce` (add it to the
 * load effect's dependencies next to the `useAutoRefresh` nonce); a later
 * success clears `stale`. All returned callbacks are referentially stable.
 */
export function useBackgroundRefresh() {
  const loaded = useRef(false);
  const attempts = useRef(0);
  const timer = useRef<number | null>(null);
  const [stale, setStale] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  /** Call after a load succeeds. */
  const succeeded = useCallback(() => {
    loaded.current = true;
    attempts.current = 0;
    clearTimer();
    setStale(false);
  }, [clearTimer]);

  /**
   * Call from the `catch` of a load. Returns true when the failure must be
   * shown (a first load, or a definitive 404 for the resource); false when it
   * was absorbed as stale, keeping the loaded data.
   */
  const failed = useCallback(
    (err?: unknown): boolean => {
      if (!loaded.current || isNotFoundError(err)) return true;
      setStale(true);
      clearTimer();
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempts.current, MAX_DELAY_MS);
      attempts.current += 1;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setRetryNonce((n) => n + 1);
      }, delay);
      return false;
    },
    [clearTimer],
  );

  /** Forget loaded state, e.g. when the page switches to a different resource. */
  const reset = useCallback(() => {
    loaded.current = false;
    attempts.current = 0;
    clearTimer();
    setStale(false);
  }, [clearTimer]);

  const hasLoaded = useCallback(() => loaded.current, []);

  return { stale, retryNonce, succeeded, failed, reset, hasLoaded };
}
