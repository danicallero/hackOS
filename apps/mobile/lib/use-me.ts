import * as Network from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { ApiError, apiFetch } from "./api";
import { readCachedValue, writeCachedValue } from "./offline-cache";
import type { Me } from "./types";

const ME_CACHE_KEY = "me";

/**
 * Loads GET /api/me and refetches on app foreground (H55: "al cambiar los
 * permisos de alguien, sus pestañas cambian sin reinstalar nada" — a
 * capability change made by an admin elsewhere must show up here without a
 * reinstall, so we refresh whenever the app comes back to the foreground,
 * plus whatever manual refetch() callers wire to pull-to-refresh).
 *
 * A device with no connectivity must not get stuck on "verifying session"
 * forever: a fetch failure that isn't a confirmed 401 (i.e. the server was
 * never actually reached to rule the session invalid) falls back to the last
 * profile persisted on this device, so a staff member can keep scanning
 * offline. Only a real 401 — the server reachable and saying the session is
 * gone — clears the cached profile and forces re-authentication.
 */
export function useMe(enabled: boolean) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [offline, setOffline] = useState(false);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const appState = useRef(AppState.currentState);
  const requestId = useRef(0);
  // Mirrors `me` synchronously so `refetch` can tell an initial load (no data
  // yet, show a loading state) apart from a background revalidation (data
  // already on screen, refresh quietly). React state alone can't do this
  // inside the same callback because `me` closes over its value at render
  // time, one tick behind the AppState listener firing mid-transition.
  const hasData = useRef(false);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const currentRequest = ++requestId.current;
    // Only block on a loading state when there's nothing to show yet. A
    // foreground refresh (e.g. iOS Control Center briefly marking the app
    // inactive) must not flip this back to true once `me` is populated —
    // callers like the tab layout unmount their navigator while loading,
    // which would flash the app back to its default tab on every transition.
    if (!hasData.current) setLoading(true);
    try {
      setError(null);
      const data = await apiFetch<Me>("/api/me");
      if (currentRequest !== requestId.current) return;
      hasData.current = true;
      setMe(data);
      setOffline(false);
      setStaleSince(null);
      void writeCachedValue(ME_CACHE_KEY, data);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      const sessionConfirmedInvalid = err instanceof ApiError && err.status === 401;
      if (sessionConfirmedInvalid) {
        hasData.current = false;
        setMe(null);
        setOffline(false);
        setStaleSince(null);
      } else if (!hasData.current) {
        // The server couldn't be confirmed as rejecting the session (network
        // failure, timeout, 5xx) — fall back to the last known profile
        // instead of leaving the app stuck behind a "verifying session" gate.
        const cached = await readCachedValue<Me>(ME_CACHE_KEY);
        if (currentRequest !== requestId.current) return;
        if (cached) {
          hasData.current = true;
          setMe(cached.data);
          setOffline(true);
          setStaleSince(cached.updatedAt);
        }
      } else {
        setOffline(true);
      }
      setError(err instanceof Error ? err : new Error("Failed to load profile"));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void refetch();
    else {
      // Invalidate a request started for the previous authenticated session
      // before clearing its profile. Otherwise a late response can restore
      // stale identity data after sign-out or session revocation.
      requestId.current += 1;
      hasData.current = false;
      setMe(null);
      setError(null);
      setLoading(false);
      setOffline(false);
      setStaleSince(null);
    }
  }, [enabled, refetch]);

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

  return { me, loading, error, offline, staleSince, refetch };
}
