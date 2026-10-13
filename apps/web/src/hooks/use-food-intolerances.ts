"use client";

import { api } from "@/lib/api";
import type { Intolerance } from "@/lib/types";
import { useServerResource } from "./use-server-resource";

const KEY = ["public", "food-intolerances"] as const;

const fetchIntolerances = (signal: AbortSignal) =>
  api
    .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances", { signal })
    .then((r) => r.intolerances);

/** Food-intolerance dictionary for dietary pickers (H12/H25). */
export function useFoodIntolerances(): {
  intolerances: Intolerance[];
  loading: boolean;
  error: unknown;
  reload: () => void;
} {
  const { data, loading, error, reload } = useServerResource(KEY, fetchIntolerances);
  return { intolerances: data ?? [], loading, error, reload };
}
