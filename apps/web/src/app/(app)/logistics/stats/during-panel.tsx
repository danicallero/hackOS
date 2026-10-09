"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { BowlFoodIcon } from "@phosphor-icons/react/dist/csr/BowlFood";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useCallback, useEffect, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { type LogisticsStats, logisticsApi, type StaffScanRankingRow } from "@/lib/logistics";
import { ActivityStatisticsDetail } from "./activity-statistics-detail";
import { ChartCard } from "./chart-card";
import { useEventChartRows } from "./event-charts";
import { Freshness } from "./freshness";
import { errorMessage, FRESHNESS_LABEL_KEYS, type FreshnessKind } from "./model";
import type { StatsChartType } from "./stats-chart";

export interface LiveStatsState {
  data: LogisticsStats | null;
  error: unknown;
  loading: boolean;
  connected: boolean;
}

export function DuringPanel({ stats }: { stats: LiveStatsState }) {
  const { t } = useLocale();
  const data = stats.data;
  const charts = useEventChartRows(data);
  const [hourlyChart, setHourlyChart] = useState<StatsChartType>("line");
  const [roleChart, setRoleChart] = useState<StatsChartType>("bar");
  const [mealChart, setMealChart] = useState<StatsChartType>("bar");
  const [selectedActivity, setSelectedActivity] = useState<{ id: number; meal: boolean } | null>(
    null,
  );
  const freshness: FreshnessKind = stats.error
    ? "incomplete"
    : stats.connected
      ? "actual"
      : "provisional";
  const mealColumns: Column<LogisticsStats["meals"][number]>[] = [
    { id: "name", header: t("columnMeal"), cell: (row) => row.name, sortValue: (row) => row.name },
    {
      id: "served",
      header: t("columnServed"),
      align: "right",
      cell: (row) => row.served,
      sortValue: (row) => row.served,
    },
    {
      id: "people",
      header: t("columnPeople"),
      align: "right",
      cell: (row) => row.distinctPeople,
      sortValue: (row) => row.distinctPeople,
    },
    {
      id: "repeat",
      header: t("columnRepeats"),
      align: "right",
      cell: (row) => row.repeats,
      sortValue: (row) => row.repeats,
    },
  ];
  const activityColumns: Column<LogisticsStats["activities"][number]>[] = [
    {
      id: "name",
      header: t("columnActivity"),
      cell: (row) => row.name,
      sortValue: (row) => row.name,
    },
    {
      id: "scans",
      header: t("columnScans"),
      align: "right",
      cell: (row) => row.scans,
      sortValue: (row) => row.scans,
    },
    {
      id: "attendees",
      header: t("columnPeople"),
      align: "right",
      cell: (row) => row.attendees,
      sortValue: (row) => row.attendees,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("accredited")}
          value={data?.accreditedCount ?? "—"}
          icon={SealCheckIcon}
          hint={t(FRESHNESS_LABEL_KEYS[freshness])}
        />
        <StatCard
          label={t("presentNow")}
          value={data?.currentlyPresent ?? "—"}
          icon={UsersIcon}
          hint={t("presentNowEstimatedWarning")}
        />
        <StatCard
          label={t("mealsServed")}
          value={data ? data.meals.reduce((sum, meal) => sum + meal.served, 0) : "—"}
          icon={BowlFoodIcon}
          hint={t(FRESHNESS_LABEL_KEYS[freshness])}
        />
        <StatCard
          label={t("activityScans")}
          value={data ? data.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={PulseIcon}
          hint={t(FRESHNESS_LABEL_KEYS[freshness])}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          className="xl:col-span-2"
          title={t("hourlyFlow")}
          rows={charts.hourly}
          chartType={hourlyChart}
          onChartTypeChange={setHourlyChart}
          state={<Freshness kind={freshness} />}
        />
        <ChartCard
          title={t("accreditedByRole")}
          rows={charts.roles}
          chartType={roleChart}
          onChartTypeChange={setRoleChart}
        />
        <ChartCard
          title={t("mealsServed")}
          rows={charts.meals}
          chartType={mealChart}
          onChartTypeChange={setMealChart}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("meals")} icon={BowlFoodIcon} state={<Freshness kind={freshness} />}>
          <DataTable
            columns={mealColumns}
            data={data?.meals ?? []}
            getRowId={(row) => String(row.activityId)}
            onRowClick={(row) => setSelectedActivity({ id: row.activityId, meal: true })}
            loading={stats.loading}
            error={
              stats.error
                ? { message: errorMessage(stats.error, t("couldNotLoadStatistics")) }
                : undefined
            }
            empty={{ icon: BowlFoodIcon, title: t("noMealScansYet") }}
          />
        </SectionCard>
        <SectionCard
          title={t("registrableActivities")}
          icon={PulseIcon}
          state={<Freshness kind={freshness} />}
        >
          <DataTable
            columns={activityColumns}
            data={data?.activities ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            error={
              stats.error
                ? { message: errorMessage(stats.error, t("couldNotLoadStatistics")) }
                : undefined
            }
            empty={{ icon: PulseIcon, title: t("noActivityScansYet") }}
            onRowClick={(row) => setSelectedActivity({ id: row.activityId, meal: false })}
          />
        </SectionCard>
      </div>
      <ActivityStatisticsDetail
        selected={selectedActivity}
        stats={data}
        connected={stats.connected}
        error={stats.error}
        onClose={() => setSelectedActivity(null)}
      />
      <StaffRankingSection />
    </div>
  );
}

export function StaffRankingSection() {
  const { t } = useLocale();
  const [rows, setRows] = useState<StaffScanRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await logisticsApi.staffScanRanking();
      setRows(items);
    } catch (err) {
      setError(errorMessage(err, t("couldNotLoadStatistics")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const columns: Column<StaffScanRankingRow>[] = [
    {
      id: "name",
      header: t("columnStaffMember"),
      cell: (row) => [row.name, row.surname].filter(Boolean).join(" ") || t("unknownPerson"),
      sortValue: (row) => [row.name, row.surname].filter(Boolean).join(" "),
    },
    {
      id: "accreditation",
      header: t("columnAccreditations"),
      align: "right",
      cell: (row) => row.accreditationCount,
      sortValue: (row) => row.accreditationCount,
    },
    {
      id: "presence",
      header: t("columnDoorScans"),
      align: "right",
      cell: (row) => row.presenceCount,
      sortValue: (row) => row.presenceCount,
    },
    {
      id: "activity",
      header: t("columnActivityScans"),
      align: "right",
      cell: (row) => row.activityCount,
      sortValue: (row) => row.activityCount,
    },
    {
      id: "total",
      header: t("columnTotal"),
      align: "right",
      cell: (row) => row.total,
      sortValue: (row) => row.total,
    },
  ];

  return (
    <SectionCard
      title={t("staffScanRanking")}
      icon={TrophyIcon}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
            loading={loading}
          >
            <ArrowsClockwiseIcon className="size-4" aria-hidden="true" />
            {t("refresh")}
          </Button>
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/staff-scan-stats.csv`}>
              <DownloadSimpleIcon className="size-4" aria-hidden="true" />
              {t("exportStaffScanStats")}
            </a>
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => String(row.staffId)}
        loading={loading}
        error={error ? { message: error, onRetry: load } : undefined}
        searchable={(row) => `${row.name} ${row.surname}`}
        searchPlaceholder={t("searchStaffMember")}
        searchLabel={t("searchStaffMember")}
        pageSize={10}
        empty={{ icon: TrophyIcon, title: t("noStaffScansYet") }}
      />
    </SectionCard>
  );
}
