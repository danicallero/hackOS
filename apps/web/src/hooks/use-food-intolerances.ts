"use client";

import { api } from "@/lib/api";
import { readServerState } from "@/lib/server-state";
import type { Intolerance } from "@/lib/types";
import { useServerResource } from "./use-server-resource";

export const FOOD_INTOLERANCES_KEY = ["public", "food-intolerances"] as const;

/** `cache` bypasses the browser's 60 s public cache after staff edits the catalogue. */
export const fetchFoodIntolerances = (signal?: AbortSignal, cache?: RequestCache) =>
  api
    .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances", { signal, cache })
    .then((r) => r.intolerances);

/** Read the shared dictionary, reusing its identity-scoped cache and in-flight request. */
export function getFoodIntolerances(): Promise<Intolerance[]> {
  return readServerState(FOOD_INTOLERANCES_KEY, fetchFoodIntolerances);
}

/** Food-intolerance dictionary for dietary pickers (H12/H25). */
export function useFoodIntolerances(): {
  intolerances: Intolerance[];
  loading: boolean;
  error: unknown;
  reload: () => void;
} {
  const { data, loading, error, reload } = useServerResource(
    FOOD_INTOLERANCES_KEY,
    fetchFoodIntolerances,
  );
  return { intolerances: data ?? [], loading, error, reload };
}
