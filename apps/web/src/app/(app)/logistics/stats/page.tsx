"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ActivityIcon,
  BadgeCheckIcon,
  DownloadIcon,
  LayoutDashboardIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SoupIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { TabBar } from "@/components/common/tab-bar";
import type { PublicEvent } from "@/components/public/public-types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-event-source";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import {
  type LogisticsStats,
  logisticsApi,
  type PresenceHours,
  type StaffScanRankingRow,
} from "@/lib/logistics";
import { useCan, useMe } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { BeforePanels } from "./before-panels";
import {
  type ApplicationStats,
  type DataPhase,
  defaultDataPhase,
  errorMessage,
  exportUrl,
  FRESHNESS_LABEL_KEYS,
  type FreshnessKind,
  type StatisticsScope,
  type StatisticsScopesResponse,
} from "./model";
import { StatsVisibility } from "./stats-visibility";

const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

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
      {t(FRESHNESS_LABEL_KEYS[kind])}
    </StatusBadge>
  );
}

const DATA_PHASES: DataPhase[] = ["before", "during", "after"];

export default function LogisticsStatsPage() {
  const { t } = useLocale();
  const me = useMe();
  const canLogisticsStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const canManageStatistics = useCan(CAPABILITIES.STATISTICS_MANAGE);
  const canExport = useCan(CAPABILITIES.EXPORTS_RUN);
  const canGeneralStats = canLogisticsStats;
  const canStats = canGeneralStats || canManageStatistics || Boolean(me?.hasStatisticsPanels);
  const {
    tab: phase,
    setTab: setPhase,
    requested,
  } = useUrlTab({
    values: DATA_PHASES,
    defaultValue: "before",
  });
  const activePhase = canGeneralStats ? phase : "before";
  const phaseWasChosen = useRef(Boolean(requested && DATA_PHASES.includes(requested as DataPhase)));
  const [scopes, setScopes] = useState<StatisticsScope[]>([]);
  const [selectedScopeKeys, setSelectedScopeKeys] = useState<string[]>([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesLoaded, setScopesLoaded] = useState(false);
  const [applicationStats, setApplicationStats] = useState<ApplicationStats | null>(null);
  const [beforeLoading, setBeforeLoading] = useState(false);
  const [beforeError, setBeforeError] = useState<string | null>(null);
  const beforeRequest = useRef(0);
  const [editMode, setEditMode] = useState(false);
  const [hours, setHours] = useState<PresenceHours[]>([]);
  const [afterLoading, setAfterLoading] = useState(false);
  const [afterError, setAfterError] = useState<string | null>(null);

  const liveStats = useLiveQuery<LogisticsStats>(
    logisticsApi.stats,
    "/api/logistics/stream",
    LOGISTICS_EVENTS,
    { enabled: canGeneralStats && activePhase === "during" },
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
    if (!canStats) return;
    setScopesLoading(true);
    setBeforeError(null);
    api
      .get<StatisticsScopesResponse>("/api/statistics/scopes")
      .then(({ scopes: items }) => {
        setScopes(items);
        setSelectedScopeKeys((current) => {
          const valid = current.filter((key) => items.some((item) => item.key === key));
          if (valid.length > 0) return valid;
          const firstApplication = items.find((item) => item.kind === "application");
          return firstApplication ? [firstApplication.key] : items[0] ? [items[0].key] : [];
        });
        setScopesLoaded(true);
      })
      .catch((error) => setBeforeError(errorMessage(error, t("couldNotLoadStatistics"))))
      .finally(() => setScopesLoading(false));
  }, [canStats, t]);

  const selectedScopes = scopes.filter((scope) => selectedScopeKeys.includes(scope.key));
  const selectedApplicationIds = selectedScopes
    .filter((scope) => scope.kind === "application")
    .map((scope) => scope.id);
  const selectedApplicationId =
    selectedApplicationIds.length === 1 ? selectedApplicationIds[0] : null;
  const layoutKey = selectedScopeKeys.slice().sort().join("|");

  const loadBefore = useCallback(async () => {
    const requestId = ++beforeRequest.current;
    if (!scopesLoaded || selectedScopeKeys.length === 0) {
      setApplicationStats(null);
      setBeforeLoading(false);
      return;
    }
    setBeforeLoading(true);
    setBeforeError(null);
    setApplicationStats(null);
    try {
      const next = await api.post<ApplicationStats>("/api/statistics/query", {
        scopes: selectedScopeKeys,
      });
      if (requestId === beforeRequest.current) setApplicationStats(next);
    } catch (error) {
      if (requestId === beforeRequest.current)
        setBeforeError(errorMessage(error, t("couldNotLoadStatistics")));
    } finally {
      if (requestId === beforeRequest.current) setBeforeLoading(false);
    }
  }, [scopesLoaded, selectedScopeKeys, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBefore();
  }, [loadBefore]);

  const loadAfter = useCallback(async () => {
    if (!canGeneralStats || activePhase !== "after") return;
    setAfterLoading(true);
    setAfterError(null);
    try {
      setHours(await logisticsApi.presenceHours());
    } catch (error) {
      setAfterError(errorMessage(error, t("couldNotLoadStatistics")));
    } finally {
      setAfterLoading(false);
    }
  }, [activePhase, canGeneralStats, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <Tabs value={activePhase} onValueChange={selectPhase}>
        <PageHeader
          title={t("logisticsStats")}
          className="sm:flex-col sm:items-stretch xl:flex-row xl:items-start"
          secondaryActions={
            <StatisticsToolbar
              activePhase={activePhase}
              canGeneralStats={canGeneralStats}
              canExport={canExport}
              editMode={editMode}
              scopes={scopes}
              selectedScopeKeys={selectedScopeKeys}
              onScopeChange={setSelectedScopeKeys}
              onEditModeChange={setEditMode}
            />
          }
        />
        <TabsContent value="before" className="mt-4">
          <BeforePanel
            applicationId={selectedApplicationId}
            layoutKey={layoutKey}
            stats={applicationStats}
            loading={beforeLoading || scopesLoading}
            error={beforeError}
            editMode={editMode}
            onRetry={loadBefore}
          />
          {canManageStatistics && selectedScopeKeys.length === 1 && (
            <StatsVisibility
              applicationId={selectedApplicationId}
              scopeKey={selectedScopeKeys[0]}
            />
          )}
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

function StatisticsToolbar({
  activePhase,
  canGeneralStats,
  canExport,
  editMode,
  scopes,
  selectedScopeKeys,
  onScopeChange,
  onEditModeChange,
}: {
  activePhase: DataPhase;
  canGeneralStats: boolean;
  canExport: boolean;
  editMode: boolean;
  scopes: StatisticsScope[];
  selectedScopeKeys: string[];
  onScopeChange: (keys: string[]) => void;
  onEditModeChange: (editing: boolean) => void;
}) {
  const { t } = useLocale();
  const scopeOptions = scopes.map((scope) => ({
    value: scope.key,
    label: scope.name,
    description: scope.kind === "application" ? t("applicationScopeLabel") : t("roleScopeLabel"),
  }));
  const exportPath = exportUrl("/api/exports/statistics.csv", {
    scopes: selectedScopeKeys.join(","),
  });
  return (
    <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
      <TabBar aria-label={t("eventPhaseLabel")} className="w-fit">
        <TabsTrigger value="before">{t("phaseBefore")}</TabsTrigger>
        {canGeneralStats && <TabsTrigger value="during">{t("phaseDuring")}</TabsTrigger>}
        {canGeneralStats && <TabsTrigger value="after">{t("phaseAfter")}</TabsTrigger>}
      </TabBar>
      <div className="min-w-56 flex-1 sm:max-w-80">
        <MultiSelect
          options={scopeOptions}
          value={selectedScopeKeys}
          onChange={onScopeChange}
          placeholder={t("selectStatisticsScopes")}
          searchPlaceholder={t("searchStatisticsScopes")}
          emptyText={t("noStatisticsScopes")}
          aria-label={t("selectStatisticsScopes")}
        />
      </div>
      <span className="text-muted-foreground whitespace-nowrap text-xs" role="status">
        {selectedScopeKeys.length > 1
          ? t("aggregatedStatisticsScopes", { count: selectedScopeKeys.length })
          : t("singleStatisticsScope")}
      </span>
      {activePhase === "before" && (
        <>
          {canExport && selectedScopeKeys.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`${API_URL}${exportPath}`}>
                <DownloadIcon className="size-4" aria-hidden="true" />
                {t("exportThisData")}
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <DownloadIcon className="size-4" aria-hidden="true" />
              {t("exportThisData")}
            </Button>
          )}
          <Button
            variant={editMode ? "secondary" : "outline"}
            size="sm"
            aria-pressed={editMode}
            onClick={() => onEditModeChange(!editMode)}
          >
            <LayoutDashboardIcon className="size-4" aria-hidden="true" />
            {editMode ? t("finishCustomizePanel") : t("customizePanel")}
          </Button>
        </>
      )}
    </div>
  );
}

function BeforePanel({
  applicationId,
  layoutKey,
  stats,
  loading,
  error,
  editMode,
  onRetry,
}: {
  applicationId: number | null;
  layoutKey: string;
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  editMode: boolean;
  onRetry: () => void;
}) {
  return (
    <BeforePanels
      applicationId={applicationId}
      layoutKey={layoutKey}
      stats={stats}
      loading={loading}
      error={error}
      editMode={editMode}
      onRetry={onRetry}
    />
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
          icon={SoupIcon}
          hint={t(FRESHNESS_LABEL_KEYS[freshness])}
        />
        <StatCard
          label={t("activityScans")}
          value={data ? data.activities.reduce((sum, activity) => sum + activity.scans, 0) : "—"}
          icon={ActivityIcon}
          hint={t(FRESHNESS_LABEL_KEYS[freshness])}
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
