"use client";

import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { MealPlanChecklist } from "@/components/profile/meal-plan-checklist";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { mealPlanSaveErrorKey, useMealPlan } from "@/hooks/use-meal-plan";
import { ApiError, api } from "@/lib/api";
import { pickText, useLocale } from "@/lib/i18n";
import {
  answersFromPlan,
  dismissProfileTasks,
  isProfileTasksDismissed,
  type MealAnswers,
} from "@/lib/meal-plan";
import { useSessionContext } from "@/lib/session";
import type { Me } from "@/lib/types";

type Task = Me["pendingProfileTasks"][number];

/**
 * Next-entry prompt (#933): one step per `pendingProfileTasks` entry from
 * /api/me. "Later" hides it for this browser session; it never blocks the app.
 */
export function ProfileTasksDialog() {
  const { me } = useSessionContext();
  const [dismissed, setDismissed] = useState(true);
  // Steps are fixed when the prompt opens so saving one doesn't reshuffle the rest.
  const [tasks, setTasks] = useState<Task[] | null>(null);

  const userId = me?.id;
  // H7: a locked profile can't change its dietary data (the API also omits the task).
  const pending = (me?.pendingProfileTasks ?? []).filter(
    (task) => task !== "dietary" || !me?.profileLocked,
  );
  const hasPending = pending.length > 0;
  useEffect(() => {
    // Safe: sessionStorage is only readable after mount (SSR has no window).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userId !== undefined) setDismissed(isProfileTasksDismissed(userId));
  }, [userId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasPending && !dismissed && tasks === null) setTasks(pending);
  }, [hasPending, dismissed, tasks, pending]);

  if (!me || !tasks || tasks.length === 0 || dismissed) return null;

  function later() {
    if (me) dismissProfileTasks(me.id);
    setDismissed(true);
  }

  return (
    <ProfileTasksSteps me={me} tasks={tasks} onLater={later} onFinished={() => setTasks([])} />
  );
}

function ProfileTasksSteps({
  me,
  tasks,
  onLater,
  onFinished,
}: {
  me: Me;
  tasks: Task[];
  onLater: () => void;
  onFinished: () => void;
}) {
  const { t } = useLocale();
  const { refresh } = useSessionContext();
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Any saved step changes `me`; refresh it however the prompt closes.
  const [saved, setSaved] = useState(false);
  const task = tasks[index];
  const formId = "profile-task-step";
  const meals = useMealPlan(task === "meal_plan" ? me.id : null);
  const blocked = task === "meal_plan" && !meals.plan;

  function close() {
    if (saved) void refresh();
    onLater();
  }

  async function advance() {
    if (index + 1 < tasks.length) {
      setIndex(index + 1);
      return;
    }
    await refresh();
    onFinished();
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setPending(true);
    try {
      await action();
      setSaved(true);
      await advance();
    } catch (err) {
      setError(
        task === "meal_plan"
          ? t(mealPlanSaveErrorKey(err))
          : err instanceof ApiError
            ? err.message
            : t("couldNotSaveProfile"),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("completeYourProfile")}
      size="md"
      footer={
        <>
          {tasks.length > 1 && (
            <span className="text-muted-foreground mr-auto self-center text-sm tabular-nums">
              {t("stepOfTotal", { current: index + 1, total: tasks.length })}
            </span>
          )}
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>
            {t("later")}
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={blocked}>
            {index + 1 < tasks.length ? t("next") : t("done")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        {error && <ContextualError message={error} />}
        {task === "dietary" ? (
          <DietaryStep key="dietary" me={me} formId={formId} disabled={pending} onSubmit={run} />
        ) : (
          <MealPlanStep
            key="meal_plan"
            formId={formId}
            meals={meals}
            disabled={pending}
            onSubmit={run}
          />
        )}
      </div>
    </Modal>
  );
}

type StepSubmit = (action: () => Promise<void>) => Promise<void>;

function DietaryStep({
  me,
  formId,
  disabled,
  onSubmit,
}: {
  me: Me;
  formId: string;
  disabled: boolean;
  onSubmit: StepSubmit;
}) {
  const { t, language } = useLocale();
  const intolerances = useFoodIntolerances();
  const [selected, setSelected] = useState<string[]>(me.foodIntolerances.map(String));
  const originalNotes = me.foodIntoleranceNotes ?? "";
  const [notes, setNotes] = useState(originalNotes);
  const [none, setNone] = useState(false);
  const [missing, setMissing] = useState(false);

  const options = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, language),
    description: i.description ? pickText(i.description, language) : undefined,
  }));

  return (
    <form
      id={formId}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        // An empty answer must be the explicit "No restrictions" choice.
        if (!none && selected.length === 0 && !notes.trim()) {
          setMissing(true);
          return;
        }
        // Untouched notes are sent as stored so a lock check sees no change.
        const nextNotes = notes === originalNotes ? me.foodIntoleranceNotes : notes.trim() || null;
        void onSubmit(async () => {
          await api.patch<Me>("/api/me", {
            foodIntolerances: none ? [] : selected.map(Number),
            foodIntoleranceNotes: none ? null : nextNotes,
          });
        });
      }}
    >
      <div className="space-y-2">
        <Label>{t("foodIntolerances")}</Label>
        <MultiSelect
          options={options}
          value={selected}
          onChange={(value) => {
            setSelected(value);
            setMissing(false);
          }}
          placeholder={t("selectIntolerances")}
          searchPlaceholder={t("searchIntolerances")}
          emptyText={t("noIntolerances")}
          disabled={disabled || none}
        />
        <p className="text-muted-foreground text-xs">{t("dietaryDataHandlingNote")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-notes`}>{t("otherDietaryNotes")}</Label>
        <Textarea
          id={`${formId}-notes`}
          rows={3}
          placeholder={t("cateringNotes")}
          value={notes}
          disabled={disabled || none}
          onChange={(event) => {
            setNotes(event.target.value);
            setMissing(false);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${formId}-none`}
          checked={none}
          disabled={disabled}
          aria-invalid={missing || undefined}
          onCheckedChange={(checked) => {
            setNone(checked === true);
            setMissing(false);
          }}
        />
        <Label htmlFor={`${formId}-none`} className="font-normal">
          {t("noRestrictions")}
        </Label>
      </div>
      {missing && <p className="text-destructive text-sm">{t("dietaryAnswerRequired")}</p>}
    </form>
  );
}

function MealPlanStep({
  formId,
  meals,
  disabled,
  onSubmit,
}: {
  formId: string;
  meals: ReturnType<typeof useMealPlan>;
  disabled: boolean;
  onSubmit: StepSubmit;
}) {
  const { t } = useLocale();
  const { plan, loadError, reload, save } = meals;
  const [answers, setAnswers] = useState<MealAnswers | null>(null);
  const current = answers ?? (plan ? answersFromPlan(plan) : {});

  return (
    <form
      id={formId}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!plan) return;
        void onSubmit(async () => {
          await save(plan, current);
        });
      }}
    >
      <h3 className="type-label">{t("meals")}</h3>
      {loadError && !plan && (
        <ContextualError message={t("couldNotLoadMealPlan")} onRetry={reload} />
      )}
      {plan && (
        <MealPlanChecklist
          plan={plan}
          answers={current}
          onChange={setAnswers}
          disabled={disabled}
        />
      )}
    </form>
  );
}
