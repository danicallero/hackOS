"use client";

import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PercentIcon } from "@phosphor-icons/react/dist/csr/Percent";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { TimerIcon } from "@phosphor-icons/react/dist/csr/Timer";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import type { LogisticsStats, PresenceHours } from "@/lib/logistics";
import { ChartCard } from "./chart-card";
import { useEventChartRows } from "./event-charts";
import { hoursDistributionRows, hoursSummary } from "./event-series";
import { Freshness } from "./freshness";
import type { ApplicationStats } from "./model";
import type { StatsChartType } from "./stats-chart";

/**
 * H27: after the event — evidence of participation and achievement: the
 * application → accreditation → attendance funnel, attendance curve, time on
 * site, and what was served and attended.
 */
export function AfterPanel({
  stats,
  applicationStats,
  hours,
  loading,
  error,
  onRetry,
}: {
  stats: LogisticsStats | null;
  applicationStats: ApplicationStats | null;
  hours: PresenceHours[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const charts = useEventChartRows(stats);
  const summary = useMemo(() => hoursSummary(hours), [hours]);
  const [funnelChart, setFunnelChart] = useState<StatsChartType>("bar");
  const [hoursChart, setHoursChart] = useState<StatsChartType>("bar");
  const [hourlyChart, setHourlyChart] = useState<StatsChartType>("line");
  const [roleChart, setRoleChart] = useState<StatsChartType>("bar");
  const [mealChart, setMealChart] = useState<StatsChartType>("bar");
  const [activityChart, setActivityChart] = useState<StatsChartType>("bar");

  const accredited = stats?.accreditedCount ?? 0;
  const confirmed = applicationStats?.overview?.confirmed ?? applicationStats?.funnel?.confirmed;
  const attendanceRate =
    accredited === 0 ? null : Math.round((summary.attended / accredited) * 100);
  const funnelRows = [
    ...(confirmed === undefined ? [] : [{ label: t("confirmed"), n: confirmed }]),
    { label: t("accredited"), n: accredited },
    { label: t("attendedStat"), n: summary.attended },
  ];
  const hoursLoaded = !loading && !error;

  const columns: Column<PresenceHours>[] = [
    {
      id: "person",
      header: t("columnPerson"),
      cell: (row) => [row.name, row.surname].filter(Boolean).join(" ") || t("unknownPerson"),
      sortValue: (row) => [row.name, row.surname].filter(Boolean).join(" "),
    },
    {
      id: "hours",
      header: t("attendanceHours"),
      align: "right",
      cell: (row) => row.hours.toFixed(2),
      sortValue: (row) => row.hours,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={t("confirmed")}
          value={confirmed ?? "—"}
          icon={SealCheckIcon}
          tone="info"
        />
        <StatCard label={t("accredited")} value={stats ? accredited : "—"} icon={UsersIcon} />
        <StatCard
          label={t("attendedStat")}
          value={hoursLoaded ? summary.attended : "—"}
          icon={UsersIcon}
          tone="success"
        />
        <StatCard
          label={t("attendanceRate")}
          value={hoursLoaded && attendanceRate !== null ? `${attendanceRate}%` : "—"}
          icon={PercentIcon}
          tone="success"
        />
        <StatCard
          label={t("averageHoursOnSite")}
          value={
            hoursLoaded && summary.averageHours !== null
              ? t("hoursShort", { value: summary.averageHours.toFixed(1) })
              : "—"
          }
          hint={
            hoursLoaded
              ? `${t("totalHours")}: ${t("hoursShort", { value: Math.round(summary.totalHours) })}`
              : undefined
          }
          icon={ClockIcon}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t("participationFunnel")}
          icon={TimerIcon}
          rows={funnelRows}
          chartType={funnelChart}
          onChartTypeChange={setFunnelChart}
        />
        <ChartCard
          title={t("hoursPerPerson")}
          rows={hoursDistributionRows(hours)}
          chartType={hoursChart}
          onChartTypeChange={setHoursChart}
          state={<Freshness kind={error ? "incomplete" : "estimated"} />}
        />
        <ChartCard
          className="xl:col-span-2"
          title={t("hourlyFlow")}
          rows={charts.hourly}
          chartType={hourlyChart}
          onChartTypeChange={setHourlyChart}
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
        <ChartCard
          className="xl:col-span-2"
          title={t("activityAttendance")}
          rows={charts.activities}
          chartType={activityChart}
          onChartTypeChange={setActivityChart}
        />
      </div>
      <SectionCard
        title={t("attendanceHours")}
        description={t("attendanceHoursEstimated")}
        icon={UsersIcon}
        state={<Freshness kind={error ? "incomplete" : "estimated"} />}
        action={
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/attendance.csv`}>
              <DownloadSimpleIcon className="size-4" aria-hidden="true" />
              {t("exportAttendance")}
            </a>
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={hours}
          getRowId={(row) => String(row.userId)}
          loading={loading}
          error={error ? { message: error, onRetry } : undefined}
          empty={{ icon: UsersIcon, title: t("noAttendanceData") }}
        />
      </SectionCard>
    </div>
  );
}
