import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { readCachedValue, writeCachedValue } from "./offline-cache";

export interface Intolerance {
  id: number;
  label: { en: string; es: string; gl: string };
}

const INTOLERANCES_CACHE_KEY = "food-intolerances";

/** Public dietary catalogue, with the last successful copy kept on device. */
export function useFoodIntolerances(enabled = true) {
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);

  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { intolerances: list } = await apiFetch<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      setIntolerances(list);
      setError(null);
      void writeCachedValue(INTOLERANCES_CACHE_KEY, list);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      // The rest of the profile remains usable without intolerance labels —
      // fall back to whatever was cached from the last successful fetch so
      // an offline first launch shows labels instead of raw numeric ids.
      try {
        const cached = await readCachedValue<Intolerance[]>(INTOLERANCES_CACHE_KEY);
        if (cached) setIntolerances(cached.data);
      } catch {
        /* The read error stays visible; existing labels are retained. */
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { intolerances, reload: load, loading, error };
}
