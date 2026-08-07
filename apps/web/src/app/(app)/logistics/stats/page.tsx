"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ActivityIcon,
  BadgeCheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SoupIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import type { PublicEvent } from "@/components/public/public-types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-event-source";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { pickText, useLocale } from "@/lib/i18n";
import {
  type LogisticsStats,
  logisticsApi,
  type PresenceHours,
  type StaffScanRankingRow,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import {
  type ApplicationStats,
  applicationStatusLabel,
  type DataPhase,
  defaultDataPhase,
  errorMessage,
  exportUrl,
  type FreshnessKind,
} from "./model";

const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

interface ApplicationOption {
  id: number;
  name: string;
}

interface LiveStatsState {
  data: LogisticsStats | null;
  error: unknown;
  loading: boolean;
  connected: boolean;
}

/** UI component for freshness indicator badge (actual/estimated/provisional/incomplete). */
function Freshness({ kind }: { kind: FreshnessKind }) {
  const { t } = useLocale();
  const tone =
    kind === "actual"
      ? "success"
      : kind === "estimated"
        ? "info"
        : kind === "incomplete"
          ? "danger"
          : "warning";
  return (
    <StatusBadge tone={tone} dot={false}>
      {t(`dataFreshness${kind[0].toUpperCase()}${kind.slice(1)}`)}
    </StatusBadge>
  );
}

const DATA_PHASES: DataPhase[] = ["before", "during", "after"];

export default function LogisticsStatsPage() {
  const { t } = useLocale();
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const canManageApplications = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canReviewApplications = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canApplications = canManageApplications || canReviewApplications;
  const {
    tab: phase,
    setTab: setPhase,
    requested,
  } = useUrlTab({
    values: DATA_PHASES,
    defaultValue: "before",
  });
  const phaseWasChosen = useRef(Boolean(requested && DATA_PHASES.includes(requested as DataPhase)));
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [applicationStats, setApplicationStats] = useState<ApplicationStats | null>(null);
  const [beforeLoading, setBeforeLoading] = useState(false);
  const [beforeError, setBeforeError] = useState<string | null>(null);
  const [hours, setHours] = useState<PresenceHours[]>([]);
  const [afterLoading, setAfterLoading] = useState(false);
  const [afterError, setAfterError] = useState<string | null>(null);

  const liveStats = useLiveQuery<LogisticsStats>(
    logisticsApi.stats,
    "/api/logistics/stream",
    LOGISTICS_EVENTS,
    { enabled: canStats },
  );

  useEffect(() => {
    if (!canStats) return;
    api
      .get<PublicEvent>("/api/public/event")
      .then((event) => {
        if (!phaseWasChosen.current) setPhase(defaultDataPhase(event));
      })
      .catch(() => undefined);
  }, [canStats, setPhase]);

  useEffect(() => {
    if (!canStats || !canApplications) return;
    setBeforeLoading(true);
    api
      .get<{ applications: ApplicationOption[] }>("/api/applications")
      .then(({ applications: items }) => {
        setApplications(items);
        setApplicationId((current) => current ?? items[0]?.id ?? null);
      })
      .catch((error) => setBeforeError(errorMessage(error, t("couldNotLoadStatistics"))))
      .finally(() => setBeforeLoading(false));
  }, [canApplications, canStats, t]);

  const loadBefore = useCallback(async () => {
    if (!applicationId) return;
    setBeforeLoading(true);
    setBeforeError(null);
    try {
      setApplicationStats(
        await api.get<ApplicationStats>(`/api/applications/${applicationId}/stats`),
      );
    } catch (error) {
      setBeforeError(errorMessage(error, t("couldNotLoadStatistics")));
    } finally {
      setBeforeLoading(false);
    }
  }, [applicationId, t]);

  useEffect(() => {
    void loadBefore();
  }, [loadBefore]);

  const loadAfter = useCallback(async () => {
    if (!canStats) return;
    setAfterLoading(true);
    setAfterError(null);
    try {
      setHours(await logisticsApi.presenceHours());
    } catch (error) {
      setAfterError(errorMessage(error, t("couldNotLoadStatistics")));
    } finally {
      setAfterLoading(false);
    }
  }, [canStats, t]);

  useEffect(() => {
    void loadAfter();
  }, [loadAfter]);

  if (!canStats) {
    return <AccessDenied ask={t("logisticsStatsDeniedDesc")} />;
  }

  const selectPhase = (value: string) => {
    phaseWasChosen.current = true;
    setPhase(value);
  };

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("logisticsStats")} />
      <Tabs value={phase} onValueChange={selectPhase}>
        <TabBar aria-label={t("eventPhaseLabel")} className="w-full sm:w-fit">
          <TabsTrigger value="before">{t("phaseBefore")}</TabsTrigger>
          <TabsTrigger value="during">{t("phaseDuring")}</TabsTrigger>
          <TabsTrigger value="after">{t("phaseAfter")}</TabsTrigger>
        </TabBar>
        <TabsContent value="before" className="mt-4">
          <BeforePanel
            applications={applications}
            applicationId={applicationId}
            stats={applicationStats}
            loading={beforeLoading}
            error={canApplications ? beforeError : t("applicationStatsAdditionalAccess")}
            onApplicationChange={setApplicationId}
            onRetry={loadBefore}
          />
        </TabsContent>
        <TabsContent value="during" className="mt-4">
          <DuringPanel stats={liveStats} />
        </TabsContent>
        <TabsContent value="after" className="mt-4">
          <AfterPanel hours={hours} loading={afterLoading} error={afterError} onRetry={loadAfter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BeforePanel({
  applications,
  applicationId,
  stats,
  loading,
  error,
  onApplicationChange,
  onRetry,
}: {
  applications: ApplicationOption[];
  applicationId: number | null;
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  onApplicationChange: (id: number) => void;
  onRetry: () => void;
}) {
  const { language, t } = useLocale();
  const statusRows = useMemo(
    () =>
      Object.entries(stats?.counts_by_status ?? {}).map(([status, count]) => ({ status, count })),
    [stats],
  );
  const statusColumns: Column<(typeof statusRows)[number]>[] = [
    {
      id: "status",
      header: t("statusColumn"),
      cell: (row) => applicationStatusLabel(row.status, t),
      sortValue: (row) => row.status,
    },
    {
      id: "count",
      header: t("columnPeople"),
      align: "right",
      cell: (row) => row.count,
      sortValue: (row) => row.count,
    },
  ];
  const dietaryColumns: Column<ApplicationStats["food_intolerances_confirmed"][number]>[] = [
    {
      id: "restriction",
      header: t("dietaryRestrictions"),
      cell: (row) => pickText(row.label, language),
      sortValue: (row) => pickText(row.label, language),
    },
    {
      id: "count",
      header: t("columnPeople"),
      align: "right",
      cell: (row) => row.n,
      sortValue: (row) => row.n,
    },
  ];
  const filters = { applicationId };
  const download = `${API_URL}${exportUrl("/api/exports/applications.csv", filters)}`;

  return (
    <div className="space-y-4">
      <SectionCard
        title={t("phaseBefore")}
        state={<Freshness kind={error || !stats ? "incomplete" : "actual"} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              value={applicationId ? String(applicationId) : ""}
              onValueChange={(value) => onApplicationChange(Number(value))}
            >
              <SelectTrigger aria-label={t("selectApplicationForStats")} className="w-full sm:w-64">
                <SelectValue placeholder={t("selectApplicationForStats")} />
              </SelectTrigger>
              <SelectContent>
                {applications.map((application) => (
                  <SelectItem key={application.id} value={String(application.id)}>
                    {application.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {applicationId ? (
              <Button asChild variant="outline">
                <a href={download}>
                  <DownloadIcon className="size-4" aria-hidden="true" />
                  {t("exportFilteredData")}
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <DownloadIcon className="size-4" aria-hidden="true" />
                {t("exportFilteredData")}
              </Button>
            )}
          </div>
        }
      >
        <DataTable
          columns={statusColumns}
          data={statusRows}
          getRowId={(row) => row.status}
          loading={loading}
          error={error ? { message: error, onRetry } : undefined}
          empty={{ icon: ClipboardListIcon, title: t("noApplicationStatistics") }}
        />
      </SectionCard>

      <SectionCard
        title={t("dietaryDistribution")}
        description={t("dietaryConfirmedOnlyPolicy")}
        icon={SoupIcon}
        state={<Freshness kind={error || !stats ? "incomplete" : "actual"} />}
      >
        <DataTable
          columns={dietaryColumns}
          data={stats?.food_intolerances_confirmed ?? []}
          getRowId={(row) => String(row.intolerance_id)}
          loading={loading}
          error={error ? { message: error, onRetry } : undefined}
          empty={{ icon: SoupIcon, title: t("noConfirmedDietaryData") }}
        />
      </SectionCard>
    </div>
  );
}

function DuringPanel({ stats }: { stats: LiveStatsState }) {
  const { t } = useLocale();
  const data = stats.data;
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
          icon={BadgeCheckIcon}
          hint={t(`dataFreshness${freshness[0].toUpperCase()}${freshness.slice(1)}`)}
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
          icon={SoupIcon}
          hint={t(`dataFreshness${freshness[0].toUpperCase()}${freshness.slice(1)}`)}
        />
        <StatCard
          label={t("activityScans")}
          value={data ? data.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={ActivityIcon}
          hint={t(`dataFreshness${freshness[0].toUpperCase()}${freshness.slice(1)}`)}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("meals")} icon={SoupIcon} state={<Freshness kind={freshness} />}>
          <DataTable
            columns={mealColumns}
            data={data?.meals ?? []}
            getRowId={(row) => String(row.activityId)}
            loading={stats.loading}
            error={
              stats.error
                ? { message: errorMessage(stats.error, t("couldNotLoadStatistics")) }
                : undefined
            }
            empty={{ icon: SoupIcon, title: t("noMealScansYet") }}
          />
        </SectionCard>
        <SectionCard
          title={t("registrableActivities")}
          icon={ActivityIcon}
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
            empty={{ icon: ActivityIcon, title: t("noActivityScansYet") }}
          />
        </SectionCard>
      </div>
      <StaffRankingSection />
    </div>
  );
}

function StaffRankingSection() {
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
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className="size-4" aria-hidden="true" />
            {t("refresh")}
          </Button>
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/staff-scan-stats.csv`}>
              <DownloadIcon className="size-4" aria-hidden="true" />
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

function AfterPanel({
  hours,
  loading,
  error,
  onRetry,
}: {
  hours: PresenceHours[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useLocale();
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
      <SectionCard
        title={t("attendanceHours")}
        description={t("attendanceHoursEstimated")}
        icon={UsersIcon}
        state={<Freshness kind={error ? "incomplete" : "estimated"} />}
        action={
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/attendance.csv`}>
              <DownloadIcon className="size-4" aria-hidden="true" />
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
      <SectionCard title={t("exportsAndPrivacy")} icon={ShieldCheckIcon}>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`${API_URL}/api/exports/meals.csv`}>
              <DownloadIcon className="size-4" aria-hidden="true" />
              {t("exportMeals")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/judging">{t("evaluationsAndQueueExports")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/users">{t("privacyOperations")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/audit">{t("auditLog")}</Link>
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
