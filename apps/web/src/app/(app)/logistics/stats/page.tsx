"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ActivityIcon, BadgeCheckIcon, LockIcon, SoupIcon, UsersIcon } from "lucide-react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { useLiveQuery } from "@/hooks/use-event-source";
import { useLocale } from "@/lib/i18n";
import { type LogisticsStats, logisticsApi } from "@/lib/logistics";
import { useCan } from "@/lib/session";

const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

export default function LogisticsStatsPage() {
  const { t } = useLocale();
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const stats = useLiveQuery<LogisticsStats>(
    logisticsApi.stats,
    "/api/logistics/stream",
    LOGISTICS_EVENTS,
    { enabled: canStats },
  );

  if (!canStats) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("logisticsStats")} />
        <EmptyState
          icon={LockIcon}
          title={t("logisticsStatsDeniedTitle")}
          description={t("logisticsStatsDeniedDesc")}
        />
      </div>
    );
  }

  const s = stats.data;

  const mealColumns: Column<LogisticsStats["meals"][number]>[] = [
    {
      id: "name",
      header: t("columnMeal"),
      sortValue: (m) => m.name,
      cell: (m) => <span className="font-medium">{m.name}</span>,
    },
    {
      id: "served",
      header: t("columnServed"),
      align: "right",
      sortValue: (m) => m.served,
      cell: (m) => m.served,
    },
    {
      id: "people",
      header: t("columnPeople"),
      align: "right",
      sortValue: (m) => m.distinctPeople,
      cell: (m) => m.distinctPeople,
    },
    {
      id: "repeat",
      header: t("columnRepeats"),
      align: "right",
      sortValue: (m) => m.repeats,
      cell: (m) => m.repeats,
    },
  ];
  const activityColumns: Column<LogisticsStats["activities"][number]>[] = [
    {
      id: "name",
      header: t("columnActivity"),
      sortValue: (a) => a.name,
      cell: (a) => <span className="font-medium">{a.name}</span>,
    },
    {
      id: "category",
      header: t("columnCategory"),
      sortValue: (a) => a.category,
      cell: (a) => <StatusBadge tone="neutral">{a.category}</StatusBadge>,
    },
    {
      id: "scans",
      header: t("columnScans"),
      align: "right",
      sortValue: (a) => a.scans,
      cell: (a) => a.scans,
    },
    {
      id: "attendees",
      header: t("columnPeople"),
      align: "right",
      sortValue: (a) => a.attendees,
      cell: (a) => a.attendees,
    },
  ];

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("logisticsStats")} description={t("logisticsStatsDescription")} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("accredited")}
          value={s?.accreditedCount ?? "—"}
          icon={BadgeCheckIcon}
          hint={t("accreditedHint")}
        />
        <StatCard
          label={t("presentNow")}
          value={s?.currentlyPresent ?? "—"}
          icon={UsersIcon}
          hint={t("presentNowHint")}
        />
        <StatCard
          label={t("mealsServed")}
          value={s ? s.meals.reduce((sum, meal) => sum + meal.served, 0) : "—"}
          icon={SoupIcon}
          hint={t("mealsServedHint")}
        />
        <StatCard
          label={t("activityScans")}
          value={s ? s.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={ActivityIcon}
          hint={stats.connected ? t("live") : t("reconnectsAutomatically")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("meals")} icon={SoupIcon}>
          <DataTable
            columns={mealColumns}
            data={s?.meals ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            empty={{ icon: SoupIcon, title: t("noMealScansYet") }}
          />
        </SectionCard>
        <SectionCard title={t("registrableActivities")} icon={ActivityIcon}>
          <DataTable
            columns={activityColumns}
            data={s?.activities ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            empty={{ icon: ActivityIcon, title: t("noActivityScansYet") }}
          />
        </SectionCard>
      </div>
    </div>
  );
}
