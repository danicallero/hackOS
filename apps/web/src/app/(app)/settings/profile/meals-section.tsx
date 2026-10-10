"use client";

import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { useEffect, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { MealPlanChecklist } from "@/components/profile/meal-plan-checklist";
import { useMealPlan } from "@/hooks/use-meal-plan";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { answersFromPlan, type MealAnswers, type MealPlan } from "@/lib/meal-plan";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";

/** Sponsor meal plan on My profile (#933). Rendered only for sponsor representatives. */
export function MealsSection({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { plan, loadError, save } = useMealPlan(true);
  const { t } = useLocale();

  if (loadError) return <ContextualError message={t("couldNotLoadMealPlan")} />;
  // Nothing offered yet: the section would be an empty list.
  if (!plan || plan.meals.length === 0) return null;
  // Remount on every saved/loaded plan so the draft restarts from the stored answers.
  const version = plan.meals.map((m) => `${m.activityId}:${m.attending}:${m.locked}`).join(",");
  return <MealsForm key={version} plan={plan} save={save} onDirtyChange={onDirtyChange} />;
}

function MealsForm({
  plan,
  save,
  onDirtyChange,
}: {
  plan: MealPlan;
  save: (plan: MealPlan, answers: MealAnswers) => Promise<MealPlan>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { refresh } = useSessionContext();
  const saved = useMemo(() => answersFromPlan(plan), [plan]);
  const [answers, setAnswers] = useState<MealAnswers>(saved);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const changed = plan.meals.some((m) => answers[m.activityId] !== saved[m.activityId]);
  // An unanswered open meal still needs a submit, even when nothing is ticked;
  // only real edits arm the leave-page guard.
  const unanswered = plan.meals.some((meal) => !meal.locked && meal.attending === null);

  useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setPending(true);
    try {
      await save(plan, answers);
      // Clears the `meal_plan` next-entry task.
      await refresh();
      toast.success(t("mealPlanSaved"), { compactTitle: t("toastSaveMealPlan") });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotSaveMealPlan");
      setSaveError(message);
      toast.error(message, t("toastSaveMealPlan"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="min-w-0" onSubmit={onSubmit}>
      <SectionCard
        footerClassName="justify-start"
        icon={ForkKnifeIcon}
        title={t("meals")}
        footer={
          <FormActions
            pending={pending}
            state={saveError ? "error" : changed || unanswered ? "unsaved" : "saved"}
          />
        }
      >
        {saveError && <ContextualError message={saveError} />}
        <MealPlanChecklist plan={plan} answers={answers} onChange={setAnswers} disabled={pending} />
      </SectionCard>
    </form>
  );
}
