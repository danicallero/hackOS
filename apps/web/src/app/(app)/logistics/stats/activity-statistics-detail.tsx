"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { pickText, useLocale } from "@/lib/i18n";
import type { LogisticsStats, MealPlanSummary } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { StatsChart } from "./stats-chart";

export function ActivityStatisticsDetail({
  selected,
  stats,
  mealPlan,
  connected,
  error,
  onClose,
}: {
  selected: { id: number; meal: boolean } | null;
  stats: LogisticsStats | null;
  /** #933: present only for meals offered to sponsors. */
  mealPlan?: MealPlanSummary;
  connected: boolean;
  error: unknown;
  onClose: () => void;
}) {
  const { t, language } = useLocale();
  const canExportPlan = useCan(CAPABILITIES.MEAL_PLANS_EXPORT);
  const meal = selected?.meal
    ? stats?.meals.find((row) => row.activityId === selected.id)
    : undefined;
  const activity =
    selected && !selected.meal
      ? stats?.activities.find((row) => row.activityId === selected.id)
      : undefined;
  const row = meal ?? activity;
  const title = row?.name ?? t("columnActivity");
  const served = meal?.served ?? activity?.scans ?? 0;
  const people = meal?.distinctPeople ?? activity?.attendees ?? 0;
  const presentAttendees = row?.presentAttendees ?? 0;
  const notAttended = Math.max(0, (stats?.currentlyPresent ?? 0) - presentAttendees);
  const coverage = [
    { label: t(meal ? "mealAlreadyEaten" : "activityAlreadyAttended"), n: presentAttendees },
    { label: t(meal ? "mealNotEatenYet" : "activityNotAttendedYet"), n: notAttended },
  ];
  const servings = [
    { label: t("firstVisits"), n: people },
    { label: t("columnRepeats"), n: row?.repeats ?? 0 },
  ];

  const planned = mealPlan
    ? [
        { label: t("mealPlanAttending"), n: mealPlan.attending },
        { label: t("mealPlanNotAttending"), n: mealPlan.notAttending },
        { label: t("columnUnanswered"), n: mealPlan.unanswered },
      ]
    : [];

  return (
    <Modal
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      className="h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] sm:max-w-none"
      headerActions={
        <StatusBadge tone={error ? "danger" : connected ? "success" : "warning"}>
          {t(
            error
              ? "dataFreshnessIncomplete"
              : connected
                ? "dataFreshnessActual"
                : "dataFreshnessProvisional",
          )}
        </StatusBadge>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{t("presentNowEstimatedWarning")}</p>
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <StatsSection title={t("currentPresenceCoverage")} data={coverage} rows={coverage} />
          <StatsSection
            title={t(meal ? "mealServingBreakdown" : "activityScanBreakdown")}
            data={servings}
            rows={[{ label: t(meal ? "columnServed" : "columnScans"), n: served }, ...servings]}
          />
          {mealPlan ? (
            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="type-section-title">{t("mealPlanBreakdown")}</h2>
                {canExportPlan ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`${API_URL}/api/logistics/meal-plans/${mealPlan.activityId}/export.csv?language=${language}`}
                    >
                      <DownloadSimpleIcon className="size-4" aria-hidden="true" />
                      {t("exportCsv")}
                    </a>
                  </Button>
                ) : null}
              </div>
              <FigureList rows={planned} />
            </section>
          ) : null}
          {mealPlan ? (
            <section className="min-w-0 space-y-3">
              <h2 className="type-section-title">{t("mealPlanDietary")}</h2>
              <dl className="divide-y divide-border/60 border-y border-border/60">
                {mealPlan.intolerances.length === 0 ? (
                  <div className="py-2 text-sm text-muted-foreground">
                    {t("mealPlanNoRestrictions")}
                  </div>
                ) : (
                  mealPlan.intolerances.map((item) => (
                    <div key={item.id} className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-sm text-muted-foreground">
                        {pickText(item.label, language)}
                      </dt>
                      <dd className="text-lg tabular-nums">{item.n}</dd>
                    </div>
                  ))
                )}
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-sm text-muted-foreground">{t("mealPlanWithNotes")}</dt>
                  <dd className="text-lg tabular-nums">{mealPlan.withNotes}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

// Donut plus one inline figure list: the single place its values are read.
function StatsSection({
  title,
  data,
  rows,
}: {
  title: string;
  data: { label: string; n: number }[];
  rows: { label: string; n: number }[];
}) {
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="type-section-title">{title}</h2>
      <StatsChart
        height="clamp(280px, min(calc(100dvh - 27rem), 60vw), 640px)"
        type="pie"
        title={title}
        data={data}
      />
      <FigureList rows={rows} />
    </section>
  );
}

function FigureList({ rows }: { rows: { label: string; n: number }[] }) {
  return (
    <dl className="divide-y divide-border/60 border-y border-border/60">
      {rows.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-lg tabular-nums">{item.n}</dd>
        </div>
      ))}
    </dl>
  );
}
