import { describe, expect, it } from "vitest";
import { answersFromPlan, type MealPlan, mealPlanBody } from "./meal-plan";

function meal(activityId: number, attending: boolean | null, locked = false) {
  return {
    activityId,
    name: `Meal ${activityId}`,
    nameI18n: null,
    startsAt: "2026-10-12T12:00:00.000Z",
    endsAt: "2026-10-12T13:00:00.000Z",
    location: null,
    attending,
    locked,
  };
}

const plan: MealPlan = {
  confirmedAt: null,
  cutoffHours: 24,
  meals: [meal(1, null), meal(2, true), meal(3, true, true), meal(4, null, true)],
};

describe("meal plan body (#933)", () => {
  it("starts unanswered meals unticked", () => {
    expect(answersFromPlan(plan)).toEqual({ 1: false, 2: true, 3: true, 4: false });
  });

  it("answers every open meal, echoes answered locked meals and skips unanswered locked ones", () => {
    expect(mealPlanBody(plan, { 1: true, 2: false, 3: false, 4: true })).toEqual({
      meals: [
        { activityId: 1, attending: true },
        { activityId: 2, attending: false },
        { activityId: 3, attending: true },
      ],
    });
  });
});
