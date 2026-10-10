import type { I18nText } from "./i18n";
import { pickText } from "./i18n";
import type { Language } from "./types";

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

export type MealAnswers = Record<number, boolean>;

/** Unanswered meals start unticked: submitting the list is the answer. */
export function answersFromPlan(plan: MealPlan): MealAnswers {
  return Object.fromEntries(plan.meals.map((meal) => [meal.activityId, meal.attending === true]));
}

/** PUT body: replace semantics, so every listed meal is sent (locked ones echo their answer). */
export function mealPlanBody(plan: MealPlan, answers: MealAnswers) {
  return {
    meals: plan.meals
      .filter((meal) => !meal.locked || meal.attending !== null)
      .map((meal) => ({
        activityId: meal.activityId,
        attending: meal.locked ? meal.attending === true : answers[meal.activityId] === true,
      })),
  };
}

export function mealName(meal: MealPlanMeal, lang: Language): string {
  return pickText(meal.nameI18n, lang) || meal.name;
}

/** "Sat, Oct 12, 14:00–15:00" in the viewer's locale. */
export function mealWhen(meal: MealPlanMeal, lang: Language): string {
  const day = new Intl.DateTimeFormat(lang, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(meal.startsAt));
  const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time.format(new Date(meal.startsAt))}–${time.format(new Date(meal.endsAt))}`;
}

/**
 * "Later" on the next-entry prompt (#933) lasts for the browser session.
 * Storage can be unavailable (private mode, blocked site data): then the
 * prompt simply returns on the next load.
 */
export function profileTasksDismissKey(userId: number): string {
  return `hackos.profileTasksDismissed.${userId}`;
}

export function isProfileTasksDismissed(userId: number): boolean {
  try {
    return window.sessionStorage.getItem(profileTasksDismissKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function dismissProfileTasks(userId: number): void {
  try {
    window.sessionStorage.setItem(profileTasksDismissKey(userId), "1");
  } catch {
    // Storage unavailable: dismissal lasts until the component unmounts.
  }
}
