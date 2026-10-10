"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Intolerance } from "@/lib/types";

// One request per page load, shared by the profile page and the next-entry prompt (#933).
let cached: Promise<Intolerance[]> | null = null;

function loadIntolerances(): Promise<Intolerance[]> {
  cached ??= api
    .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
    .then((r) => r.intolerances)
    .catch(() => {
      // Retry on the next mount instead of caching the failure.
      cached = null;
      return [];
    });
  return cached;
}

/** Food-intolerance dictionary for dietary pickers (H12/H25). */
export function useFoodIntolerances(): Intolerance[] {
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadIntolerances().then((list) => {
      if (!cancelled) setIntolerances(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return intolerances;
}

/** Test seam: forget the cached dictionary. */
export function resetFoodIntolerancesCache(): void {
  cached = null;
}
