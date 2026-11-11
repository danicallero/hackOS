import type { I18nText } from "./i18n";

/** Sponsor meal plan (#933), as returned by GET/PUT /api/me/meal-plan. */
export interface MealPlanMeal {
  activityId: number;
  name: string;
  nameI18n: I18nText | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  attending: boolean | null;
  locked: boolean;
}

export interface MealPlan {
  confirmedAt: string | null;
  cutoffHours: number;
  meals: MealPlanMeal[];
}
