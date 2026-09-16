import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { ApiError, apiFetch, getCurrentSessionCookie } from "./api";
import {
  clearCachedValue,
  clearCachedValues,
  readCachedValue,
  writeCachedValue,
} from "./offline-cache";
import type { Me } from "./types";

/** GET /api/me is JSON data, so a value comparison can retain a stable context snapshot. */
function sameProfile(current: Me | null, next: Me): boolean {
  return current !== null && JSON.stringify(current) === JSON.stringify(next);
}

/** Stable, non-secret namespace for one Better Auth session cookie. */
export function profileCacheKeyForSession(sessionCookie: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < sessionCookie.length; index += 1) {
    hash ^= sessionCookie.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `me:session:${(hash >>> 0).toString(16)}:${sessionCookie.length}`;
}

/**
 * Loads GET /api/me and refetches on app foreground (H55: "al cambiar los
 * permisos de alguien, sus pestañas cambian sin reinstalar nada" — a
 * capability or role-derived event-access change made by an admin elsewhere
 * must show up here without a reinstall, so we refresh whenever the app comes
 * back to the foreground, plus whatever manual refetch() callers wire to
 * pull-to-refresh).
 *
 * A device with no connectivity must not get stuck on "verifying session"
 * forever: a fetch failure that isn't a confirmed 401 (i.e. the server was
 * never actually reached to rule the session invalid) falls back only to the
 * profile persisted for the exact current Better Auth session, so a staff
 * member can keep scanning offline without restoring another account's data.
 * If no session cookie is available, identity fallback is disabled. Only a
 * real 401 — the server reachable and saying the session is gone — clears the
 * matching cached profile and forces re-authentication.
 */
export function useMe(enabled = true) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [offline, setOffline] = useState(false);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  const requestId = useRef(0);
  const meRef = useRef<Me | null>(null);
  const inFlight = useRef<Promise<Me | null> | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const cacheKeyRef = useRef<string | null>(null);
  const cacheGeneration = useRef(0);
  // An unauthenticated foreground revalidation must not toggle the root
  // navigator into its restoring-session screen. That would unmount the
  // credential fields while iOS Password AutoFill has them focused (#732).
  const hasResolved = useRef(!enabled);
  // Mirrors `me` synchronously so `refetch` can tell an initial load (no data
  // yet, show a loading state) apart from a background revalidation (data
  // already on screen, refresh quietly). React state alone can't do this
  // inside the same callback because `me` closes over its value at render
  // time, one tick behind the AppState listener firing mid-transition.
  const hasData = useRef(false);

  const clear = useCallback(() => {
    // Invalidate a request before clearing its profile. Otherwise a late
    // response can restore stale identity data after sign-out or revocation.
    requestId.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    inFlight.current = null;
    cacheGeneration.current += 1;
    const previousMe = meRef.current;
    const previousCacheKey = cacheKeyRef.current;
    cacheKeyRef.current = null;
    meRef.current = null;
    hasData.current = false;
    hasResolved.current = !enabled;
    setMe(null);
    setError(null);
    setLoading(false);
    setOffline(false);
    setStaleSince(null);
    if (previousCacheKey) void clearCachedValue(previousCacheKey);
    if (previousMe) void clearCachedValues(`user:${previousMe.id}:`);
  }, [enabled]);

  const refetch = useCallback((): Promise<Me | null> => {
    if (!enabled) return Promise.resolve(null);
    if (inFlight.current) return inFlight.current;

    const request = (async (): Promise<Me | null> => {
      const currentRequest = ++requestId.current;
      const sessionCookie = getCurrentSessionCookie();
      const cacheKey = sessionCookie ? profileCacheKeyForSession(sessionCookie) : null;
      if (cacheKeyRef.current !== cacheKey) {
        cacheGeneration.current += 1;
        cacheKeyRef.current = cacheKey;
      }
      const controller = new AbortController();
      activeController.current = controller;
      // Only block on a loading state when there's nothing to show yet. A
      // foreground refresh (e.g. iOS Control Center briefly marking the app
      // inactive) must not flip this back to true once `me` is populated —
      // callers like the tab layout unmount their navigator while loading,
      // which would flash the app back to its default tab on every transition.
      if (!hasData.current && !hasResolved.current) setLoading(true);
      try {
        setError(null);
        const data = await apiFetch<Me>("/api/me", {
          signal: controller.signal,
          ...(sessionCookie ? { sessionCookie } : {}),
        });
        if (currentRequest !== requestId.current) return null;
        hasData.current = true;
        // A foreground or event-driven revalidation frequently returns the
        // same profile. Preserve the snapshot reference in that case so every
        // context consumer — including live native fields — does not re-render
        // for data that did not actually change. Changed labels, capabilities,
        // and account state still publish the new authoritative snapshot.
        if (!sameProfile(meRef.current, data)) {
          meRef.current = data;
          setMe(data);
        }
        setOffline(false);
        setStaleSince(null);
        const generationAtWrite = cacheGeneration.current;
        if (cacheKey) {
          void writeCachedValue(cacheKey, data).then(() => {
            // A successful response may finish its async storage write after a
            // sign-out/401 cleanup. Do not let that late write resurrect the
            // previous identity on the next offline launch.
            if (cacheGeneration.current !== generationAtWrite || cacheKeyRef.current !== cacheKey) {
              void clearCachedValue(cacheKey);
            }
          });
        }
        return data;
      } catch (err) {
        if (currentRequest !== requestId.current) return null;
        const sessionConfirmedInvalid = err instanceof ApiError && err.status === 401;
        if (sessionConfirmedInvalid) {
          const invalidatedMe = meRef.current;
          cacheGeneration.current += 1;
          hasData.current = false;
          meRef.current = null;
          setMe(null);
          setError(null);
          setOffline(false);
          setStaleSince(null);
          if (cacheKey) void clearCachedValue(cacheKey);
          if (invalidatedMe) void clearCachedValues(`user:${invalidatedMe.id}:`);
          return null;
        } else if (!hasData.current) {
          // The server couldn't be confirmed as rejecting the session (network
          // failure, timeout, 5xx) — fall back to the last known profile
          // instead of leaving the app stuck behind a "verifying session" gate.
          const cached = cacheKey ? await readCachedValue<Me>(cacheKey) : null;
          if (currentRequest !== requestId.current) return null;
          if (cached) {
            hasData.current = true;
            meRef.current = cached.data;
            setMe(cached.data);
            setOffline(true);
            setStaleSince(cached.updatedAt);
          }
        } else {
          setOffline(true);
        }
        setError(err instanceof Error ? err : new Error("Failed to load profile"));
        return meRef.current;
      } finally {
        if (activeController.current === controller) activeController.current = null;
        if (currentRequest === requestId.current) {
          hasResolved.current = true;
          setLoading(false);
        }
      }
    })();

    let tracked: Promise<Me | null>;
    tracked = request.finally(() => {
      if (inFlight.current === tracked) inFlight.current = null;
    });
    inFlight.current = tracked;
    return tracked;
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      hasResolved.current = false;
      void refetch();
    } else clear();
  }, [clear, enabled, refetch]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        void refetch();
      }
      appState.current = next;
    });
    return () => subscription.remove();
  }, [refetch]);

  // Try to restore the real session as soon as connectivity comes back,
  // instead of waiting for the next foreground transition or manual retry.
  useEffect(() => {
    if (!enabled || !offline) return;
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected) void refetch();
    });
    return () => subscription.remove();
  }, [enabled, offline, refetch]);

  // Memoized so MeProvider's context value stays referentially stable across
  // renders that don't change any of these fields — otherwise every consumer
  // of useMeContext() re-renders on each revalidation (e.g. iOS briefly
  // marking the app inactive), regardless of whether its own data changed.
  return useMemo(
    () => ({
      me,
      authenticated: me !== null,
      loading,
      error,
      offline,
      staleSince,
      refetch,
      clear,
    }),
    [me, loading, error, offline, staleSince, refetch, clear],
  );
}
