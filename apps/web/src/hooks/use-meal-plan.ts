"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import { apiErrorReason } from "@/lib/api-error-reason";
import { type MealAnswers, type MealPlan, mealPlanBody } from "@/lib/meal-plan";
import { invalidateServerState, readServerState } from "@/lib/server-state";
import { useServerResource } from "./use-server-resource";

/**
 * One meal plan per signed-in user, shared by every caller (#933): the
 * next-entry prompt and My profile read and write the same server-state
 * resource, so saving in one never leaves the other submitting stale answers.
 */

/** Errors after which the stored plan differs from what the caller submitted. */
const STALE_PLAN_CODES = new Set(["meal_plan_incomplete", "meal_plan_locked", "meal_not_offered"]);

/** Localized message key for a failed meal-plan save. */
export function mealPlanSaveErrorKey(err: unknown) {
  const reason = apiErrorReason(err);
  if (reason === "meal_plan_incomplete") return "mealPlanChangedReview";
  if (reason === "meal_plan_locked") return "mealPlanLockedReview";
  if (reason === "meal_not_offered") return "mealPlanChangedReview";
  return "couldNotSaveMealPlan";
}

const mealPlanKey = (userId: number | null) => ["me", "meal-plan", userId] as const;
const fetchMealPlan = (signal: AbortSignal) => api.get<MealPlan>("/api/me/meal-plan", { signal });

/** The caller's sponsor meal plan (#933); pass `null` for non-sponsors (the API is 403). */
export function useMealPlan(userId: number | null) {
  const { data, error, reload, mutate } = useServerResource(mealPlanKey(userId), fetchMealPlan, {
    enabled: userId !== null,
  });

  const save = useCallback(
    async (plan: MealPlan, answers: MealAnswers) => {
      try {
        const next = await api.put<MealPlan>("/api/me/meal-plan", mealPlanBody(plan, answers));
        if (userId !== null) mutate(next);
        return next;
      } catch (err) {
        // The offered list or a lock changed under the caller: show the current plan.
        if (userId !== null && STALE_PLAN_CODES.has(apiErrorReason(err) ?? "")) {
          invalidateServerState(mealPlanKey(userId));
          await readServerState(mealPlanKey(userId), fetchMealPlan).then(mutate, () => reload());
        }
        throw err;
      }
    },
    [userId, mutate, reload],
  );

  return {
    plan: data,
    loading: userId !== null && data === null && !error,
    loadError: data === null && Boolean(error),
    reload,
    save,
  };
}
