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

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      setError(null);
      const data = await apiFetch<Me>("/api/me");
      if (currentRequest !== requestId.current) return;
      setMe(data);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      if (err instanceof ApiError && err.status === 401) setMe(null);
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
