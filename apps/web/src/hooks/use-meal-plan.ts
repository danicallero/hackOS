"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { type MealAnswers, type MealPlan, mealPlanBody } from "@/lib/meal-plan";

/** The caller's sponsor meal plan (#933); `enabled` is false for non-sponsors (the API is 403). */
export function useMealPlan(enabled: boolean) {
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get<MealPlan>("/api/me/meal-plan")
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const save = useCallback(async (current: MealPlan, answers: MealAnswers) => {
    const next = await api.put<MealPlan>("/api/me/meal-plan", mealPlanBody(current, answers), {
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    setPlan(next);
    return next;
  }, []);

  return { plan, loadError, save };
}
