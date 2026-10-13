"use client";

import { api } from "@/lib/api";
import { invalidateServerState, readServerState, writeServerState } from "@/lib/server-state";
import type { Intolerance } from "@/lib/types";
import { useServerResource } from "./use-server-resource";

const KEY = ["public", "food-intolerances"] as const;

const fetchIntolerances = (signal: AbortSignal) =>
  api
    .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances", { signal })
    .then((r) => r.intolerances);

/** Read the shared dictionary, reusing its identity-scoped cache and in-flight request. */
export function getFoodIntolerances(): Promise<Intolerance[]> {
  return readServerState(KEY, fetchIntolerances);
}

/** Force an authoritative read and publish it to mounted dictionary consumers. */
export async function refreshFoodIntolerances(): Promise<Intolerance[]> {
  invalidateServerState(KEY);
  const intolerances = await getFoodIntolerances();
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
