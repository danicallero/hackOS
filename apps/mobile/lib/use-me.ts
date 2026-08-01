import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { ApiError, apiFetch } from "./api";
import type { Me } from "./types";

/**
 * Loads GET /api/me and refetches on app foreground (H55: "al cambiar los
 * permisos de alguien, sus pestañas cambian sin reinstalar nada" — a
 * capability change made by an admin elsewhere must show up here without a
 * reinstall, so we refresh whenever the app comes back to the foreground,
 * plus whatever manual refetch() callers wire to pull-to-refresh).
 */
export function useMe(enabled: boolean) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
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
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      if (err instanceof ApiError && err.status === 401) {
        hasData.current = false;
        setMe(null);
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

  return { me, loading, error, refetch };
}
