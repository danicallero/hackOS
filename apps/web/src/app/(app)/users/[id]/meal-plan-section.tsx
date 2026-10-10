"use client";

// #933: a sponsor representative's meal plan on the staff profile. Readable
// with users:read, editable with meal-plans:manage (audited server-side).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { BowlFoodIcon } from "@phosphor-icons/react/dist/csr/BowlFood";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError, api } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { pickText, useLocale } from "@/lib/i18n";
import { idempotencyHeaders } from "@/lib/logistics";
import type { MealPlan, MealPlanMeal } from "@/lib/meal-plan";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";

export function MealPlanSection({ userId }: { userId: number }) {
  const { t, language } = useLocale();
  const canManage = useCan(CAPABILITIES.MEAL_PLANS_MANAGE);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  // Only explicit answers: an unanswered meal stays absent until staff tick
  // it, so saving never turns "no answer" into "not attending".
  const [draft, setDraft] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  const apply = useCallback((next: MealPlan) => {
    setPlan(next);
    setDraft(
      Object.fromEntries(
        next.meals.flatMap((m) => (m.attending === null ? [] : [[m.activityId, m.attending]])),
      ),
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is a retry nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setDraft({});
    setLoadFailed(false);
    api
      .get<MealPlan>(`/api/users/${userId}/meal-plan`)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((err) => {
        // Not a sponsor representative: no section.
        if (cancelled || (err instanceof ApiError && err.code === "not_sponsor")) return;
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, apply, reload]);

  if (loadFailed) {
    return (
      <SectionCard variant="plain" title={t("meals")} icon={BowlFoodIcon}>
        <ContextualError
          message={t("couldNotLoadMealPlan")}
          onRetry={() => setReload((n) => n + 1)}
        />
      </SectionCard>
    );
  }
  if (!plan || plan.meals.length === 0) return null;

  const editable = (meal: MealPlanMeal) => canManage && !meal.locked;
  const edited = plan.meals.filter(
    (m) => editable(m) && m.activityId in draft && draft[m.activityId] !== m.attending,
  );
  const dirty = edited.length > 0;

  async function save() {
    if (!plan) return;
    setSaving(true);
    try {
      const next = await api.put<MealPlan>(
        `/api/users/${userId}/meal-plan`,
        {
          meals: edited.map((m) => ({ activityId: m.activityId, attending: draft[m.activityId] })),
        },
        { headers: idempotencyHeaders("meal-plan") },
      );
      apply(next);
      toast.success(t("mealPlanSaved"), { compactTitle: t("toastSaveMealPlan") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveMealPlan"),
        t("toastSaveMealPlan"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      variant="plain"
      title={t("meals")}
      icon={BowlFoodIcon}
      footer={
        canManage ? (
          <Button onClick={() => void save()} disabled={!dirty || saving} loading={saving}>
            {t("saveChanges")}
          </Button>
        ) : undefined
      }
    >
      <ul className="divide-y divide-border/60">
        {plan.meals.map((meal) => {
          const id = `meal-plan-${meal.activityId}`;
          return (
            <li key={meal.activityId} className="flex items-center gap-3 py-2">
              <Checkbox
                id={id}
                checked={draft[meal.activityId] === true}
                disabled={!editable(meal)}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, [meal.activityId]: checked === true }))
                }
              />
              <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                {pickText(meal.nameI18n, language) || meal.name}
                <span className="ml-2 text-muted-foreground tabular-nums">
                  {formatScheduledDateTime(meal.startsAt, language)}
                </span>
              </label>
              {!(meal.activityId in draft) ? (
                <StatusBadge tone="neutral">{t("columnUnanswered")}</StatusBadge>
              ) : null}
              {meal.locked ? <StatusBadge tone="neutral">{t("mealPlanClosed")}</StatusBadge> : null}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
