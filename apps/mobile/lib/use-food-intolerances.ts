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

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const { intolerances: list } = await apiFetch<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      setIntolerances(list);
      void writeCachedValue(INTOLERANCES_CACHE_KEY, list);
    } catch {
      // The rest of the profile remains usable without intolerance labels —
      // fall back to whatever was cached from the last successful fetch so
      // an offline first launch shows labels instead of raw numeric ids.
      const cached = await readCachedValue<Intolerance[]>(INTOLERANCES_CACHE_KEY);
      if (cached) setIntolerances(cached.data);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { intolerances, reload: load };
}
