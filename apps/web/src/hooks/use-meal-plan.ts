"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ApiError, api } from "@/lib/api";
import { type MealAnswers, type MealPlan, mealPlanBody } from "@/lib/meal-plan";

/**
 * One meal plan per signed-in user, shared by every caller (#933): the
 * next-entry prompt and My profile read and write the same copy, so saving in
 * one never leaves the other submitting stale answers.
 */
interface MealPlanState {
  userId: number | null;
  plan: MealPlan | null;
  status: "idle" | "loading" | "ready" | "error";
}

const INITIAL: MealPlanState = { userId: null, plan: null, status: "idle" };
let state = INITIAL;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: MealPlanState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(userId: number): Promise<void> {
  if (inflight && state.userId === userId) return inflight;
  const plan = state.userId === userId ? state.plan : null;
  setState({ userId, plan, status: "loading" });
  const request: Promise<void> = api
    .get<MealPlan>("/api/me/meal-plan")
    .then(
      (next) => {
        if (state.userId === userId) setState({ userId, plan: next, status: "ready" });
      },
      () => {
        if (state.userId === userId) setState({ userId, plan, status: "error" });
      },
    )
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Errors after which the stored plan differs from what the caller submitted. */
const STALE_PLAN_CODES = new Set(["meal_plan_incomplete", "meal_plan_locked", "meal_not_offered"]);

/** Localized message key for a failed meal-plan save. */
export function mealPlanSaveErrorKey(err: unknown) {
  if (err instanceof ApiError) {
    if (err.code === "meal_plan_incomplete") return "mealPlanChangedReview";
    if (err.code === "meal_plan_locked") return "mealPlanLockedReview";
    if (err.code === "meal_not_offered") return "mealPlanChangedReview";
  }
  return "couldNotSaveMealPlan";
}

/** The caller's sponsor meal plan (#933); pass `null` for non-sponsors (the API is 403). */
export function useMealPlan(userId: number | null) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
  const current = userId !== null && snapshot.userId === userId ? snapshot : INITIAL;

  useEffect(() => {
    if (userId === null) return;
    if (state.userId !== userId || state.status === "idle") void load(userId);
  }, [userId]);

  const reload = useCallback(() => {
    if (userId !== null) void load(userId);
  }, [userId]);

  const save = useCallback(
    async (plan: MealPlan, answers: MealAnswers) => {
      try {
        const next = await api.put<MealPlan>("/api/me/meal-plan", mealPlanBody(plan, answers), {
          headers: { "idempotency-key": crypto.randomUUID() },
        });
        if (userId !== null) setState({ userId, plan: next, status: "ready" });
        return next;
      } catch (err) {
        // The offered list or a lock changed under the caller: show the current plan.
        if (userId !== null && err instanceof ApiError && STALE_PLAN_CODES.has(err.code)) {
          await load(userId);
        }
        throw err;
      }
    },
    [userId],
  );

  return {
    plan: current.plan,
    loading: current.plan === null && current.status !== "error",
    loadError: current.status === "error",
    reload,
    save,
  };
}

/** Test seam: forget the shared plan. */
export function resetMealPlanStore(): void {
  inflight = null;
  state = INITIAL;
}
