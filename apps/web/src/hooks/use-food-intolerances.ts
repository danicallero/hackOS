"use client";

import { api } from "@/lib/api";
import { invalidateServerState, readServerState, writeServerState } from "@/lib/server-state";
import type { Intolerance } from "@/lib/types";
import { useServerResource } from "./use-server-resource";

const KEY = ["public", "food-intolerances"] as const;

const fetchIntolerances = (signal: AbortSignal, cache?: RequestCache) =>
  api
    .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances", { signal, cache })
    .then((r) => r.intolerances);

/** Read the shared dictionary, reusing its identity-scoped cache and in-flight request. */
export function getFoodIntolerances(): Promise<Intolerance[]> {
  return readServerState(KEY, fetchIntolerances);
}

/** Force an authoritative read and publish it to mounted dictionary consumers. */
export async function refreshFoodIntolerances(): Promise<Intolerance[]> {
  invalidateServerState(KEY);
  // Staff just edited the catalogue; skip the browser's 60 s public cache.
  const intolerances = await readServerState(KEY, (signal) =>
    fetchIntolerances(signal, "no-cache"),
  );
  writeServerState(KEY, intolerances);
  return intolerances;
}

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
