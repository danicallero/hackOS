import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { apiFetch } from "./api";
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

  const refetch = useCallback(async () => {
    if (!enabled) return;
    try {
      setError(null);
      const data = await apiFetch<Me>("/api/me");
      setMe(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load profile"));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) void refetch();
    else {
      setMe(null);
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
