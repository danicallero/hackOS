"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocale } from "@/lib/i18n";
import { type MealAnswers, type MealPlan, mealName, mealWhen } from "@/lib/meal-plan";

/** One checkbox per offered meal (#933); meals inside the cutoff are read-only. */
export function MealPlanChecklist({
  plan,
  answers,
  onChange,
  disabled = false,
}: {
  plan: MealPlan;
  answers: MealAnswers;
  onChange: (answers: MealAnswers) => void;
  disabled?: boolean;
}) {
  const { t, language: lang } = useLocale();
  const baseId = useId();

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/60">
        {plan.meals.map((meal) => {
          const id = `${baseId}-${meal.activityId}`;
          return (
            <li key={meal.activityId} className="flex min-h-11 items-center gap-3 py-2">
              <Checkbox
                id={id}
                checked={answers[meal.activityId] === true}
                disabled={disabled || meal.locked}
                onCheckedChange={(checked) =>
                  onChange({ ...answers, [meal.activityId]: checked === true })
                }
              />
              <label
                htmlFor={id}
                className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 text-sm peer-disabled:cursor-not-allowed peer-disabled:opacity-60"
              >
                <span className="min-w-0 font-medium wrap-anywhere">{mealName(meal, lang)}</span>
                <span className="text-muted-foreground tabular-nums">{mealWhen(meal, lang)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        {t("mealPlanLockNotice", { hours: plan.cutoffHours })}
      </p>
    </div>
  );
}
