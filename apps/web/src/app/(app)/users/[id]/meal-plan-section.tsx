"use client";

// #933: a sponsor representative's meal plan on the staff profile. Readable
// with users:read, editable with meal-plans:manage (audited server-side).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { BowlFoodIcon } from "@phosphor-icons/react/dist/csr/BowlFood";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError, api } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { type I18nText, pickText, useLocale } from "@/lib/i18n";
import { idempotencyHeaders } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";

export interface StaffMealPlan {
  confirmedAt: string | null;
  meals: Array<{
    activityId: number;
    name: string;
    nameI18n: I18nText | null;
    startsAt: string;
    attending: boolean | null;
    locked: boolean;
  }>;
}

export function MealPlanSection({ userId }: { userId: number }) {
  const { t, language } = useLocale();
  const canManage = useCan(CAPABILITIES.MEAL_PLANS_MANAGE);
  const [plan, setPlan] = useState<StaffMealPlan | null>(null);
  const [draft, setDraft] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);

  const apply = useCallback((next: StaffMealPlan) => {
    setPlan(next);
    setDraft(Object.fromEntries(next.meals.map((m) => [m.activityId, m.attending === true])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<StaffMealPlan>(`/api/users/${userId}/meal-plan`)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      // Not a sponsor representative (403) or unreadable: no section.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, apply]);

  if (!plan || plan.meals.length === 0) return null;

  const editable = (meal: StaffMealPlan["meals"][number]) => canManage && !meal.locked;
  const dirty = plan.meals.some(
    (m) => editable(m) && (m.attending === null || draft[m.activityId] !== m.attending),
  );

  async function save() {
    if (!plan) return;
    setSaving(true);
    try {
      const next = await api.put<StaffMealPlan>(
        `/api/users/${userId}/meal-plan`,
        {
          meals: plan.meals
            .filter((m) => !m.locked)
            .map((m) => ({ activityId: m.activityId, attending: draft[m.activityId] === true })),
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
              {meal.attending === null ? (
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
