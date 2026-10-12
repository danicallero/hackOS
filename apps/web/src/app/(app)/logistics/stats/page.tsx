"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { StatisticsParticipantStatus } from "@hackos/shared/statistics";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StatisticsExportPanel } from "@/components/exports/statistics-export-panel";
import type { PublicEvent } from "@/components/public/public-types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-event-source";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { type LogisticsStats, logisticsApi, type PresenceHours } from "@/lib/logistics";
import { useCan, useMe } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { AfterPanel } from "./after-panel";
import { BeforePanels } from "./before-panels";
import { DuringPanel } from "./during-panel";
import {
  type ApplicationStats,
  type DataPhase,
  defaultDataPhase,
  errorMessage,
  type StatisticsScope,
  type StatisticsScopesResponse,
} from "./model";
import { StatisticsToolbar } from "./statistics-toolbar";
import { StatsVisibility } from "./stats-visibility";

const LOGISTICS_EVENTS = [
  EVENTS.LOGISTICS_ACCREDITED,
  EVENTS.LOGISTICS_BADGE_ROTATED,
  EVENTS.LOGISTICS_PRESENCE_SCAN,
  EVENTS.LOGISTICS_ACTIVITY_SCAN,
  EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
  EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
];

// #933: planned headcounts only change when a meal plan does.
const MEAL_PLAN_EVENTS = [EVENTS.LOGISTICS_MEAL_PLAN_UPDATED];

const DATA_PHASES: DataPhase[] = ["before", "during", "after"];
const EMPTY_SCOPE_FILTERS: string[] = [];
const EMPTY_PARTICIPANT_FILTERS: Record<string, StatisticsParticipantStatus[]> = {};

export default function LogisticsStatsPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
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
  const [selectedScopeKeys, setSelectedScopeKeys] = usePersistedState<string[] | null>(
    "logistics-stats:scope-filters",
    null,
  );
  const activeScopeFilters = selectedScopeKeys ?? EMPTY_SCOPE_FILTERS;
  const [participantStatusesByApplication, setParticipantStatusesByApplication] =
    usePersistedState<Record<string, StatisticsParticipantStatus[]> | null>(
      "logistics-stats:participant-status-filters",
      null,
    );
  const activeParticipantStatusFilters =
    participantStatusesByApplication ?? EMPTY_PARTICIPANT_FILTERS;
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
    { enabled: canGeneralStats && activePhase !== "before" },
  );
  const mealPlans = useLiveQuery(
    logisticsApi.mealPlans,
    "/api/logistics/stream",
    MEAL_PLAN_EVENTS,
    {
      enabled: canGeneralStats && activePhase === "during",
    },
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
          const valid = (current ?? []).filter((key) => items.some((item) => item.key === key));
          if (current !== null) return valid;
          const firstApplication = items.find((item) => item.kind === "application");
          return firstApplication ? [firstApplication.key] : items[0] ? [items[0].key] : [];
        });
        setScopesLoaded(true);
      })
      .catch((error) => setBeforeError(errorMessage(error, t("couldNotLoadStatistics"))))
      .finally(() => setScopesLoading(false));
  }, [canStats, setSelectedScopeKeys, t]);

  const selectedScopes = useMemo(
    () => scopes.filter((scope) => activeScopeFilters.includes(scope.key)),
    [scopes, activeScopeFilters],
  );
  const selectedApplicationIds = selectedScopes
    .filter((scope) => scope.kind === "application")
    .map((scope) => scope.id);
  const selectedApplicationId =
    selectedApplicationIds.length === 1 ? selectedApplicationIds[0] : null;
  const layoutKey = activeScopeFilters.slice().sort().join("|");

  const loadBefore = useCallback(
    async (background = false) => {
      const requestId = ++beforeRequest.current;
      // Application figures feed the before charts and the after funnel only.
      if (activePhase === "during") return;
      if (!scopesLoaded || activeScopeFilters.length === 0) {
        setApplicationStats(null);
        setBeforeLoading(false);
        return;
      }
      setBeforeLoading(true);
      setBeforeError(null);
      if (!background) setApplicationStats(null);
      try {
        const participantFilters = Object.fromEntries(
          selectedScopes
            .filter((scope) => scope.kind === "application")
            .map((scope) => [
              scope.key,
              activeParticipantStatusFilters[scope.key] ?? ["confirmed"],
            ]),
        );
        const next = await api.post<ApplicationStats>("/api/statistics/query", {
          scopes: activeScopeFilters,
          participant_filters: participantFilters,
        });
        if (requestId === beforeRequest.current) setApplicationStats(next);
      } catch (error) {
        if (requestId === beforeRequest.current)
          setBeforeError(errorMessage(error, t("couldNotLoadStatistics")));
      } finally {
        if (requestId === beforeRequest.current) setBeforeLoading(false);
      }
    },
    [
      activeParticipantStatusFilters,
      activePhase,
      activeScopeFilters,
      scopesLoaded,
      selectedScopes,
      t,
    ],
  );

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
    <PageLayout width="workspace">
      <PageHeader
        className="flex-row items-center justify-between gap-2 md:items-center"
        title={t("logisticsStats")}
        secondaryActions={
          <>
            {isMobile ? (
              <IconButton
                variant={editMode ? "secondary" : "outline"}
                label={t(editMode ? "finishCustomizePanel" : "customizePanel")}
                aria-pressed={editMode}
                onClick={() => setEditMode(!editMode)}
              >
                <SquaresFourIcon aria-hidden="true" />
              </IconButton>
            ) : (
              <Button
                variant={editMode ? "secondary" : "outline"}
                size="default"
                aria-pressed={editMode}
                onClick={() => setEditMode(!editMode)}
              >
                <SquaresFourIcon aria-hidden="true" />
                {t(editMode ? "finishCustomizePanel" : "customizePanel")}
              </Button>
            )}
            {canExport && (
              <StatisticsExportPanel
                trigger={
                  isMobile ? (
                    <IconButton variant="outline" label={t("export")}>
                      <DownloadSimpleIcon aria-hidden="true" />
                    </IconButton>
                  ) : undefined
                }
              />
            )}
          </>
        }
      />
      <Tabs value={activePhase} onValueChange={selectPhase}>
        <StatisticsToolbar
          activePhase={activePhase}
          canGeneralStats={canGeneralStats}
          scopes={scopes}
          selectedScopeKeys={activeScopeFilters}
          participantStatusesByApplication={activeParticipantStatusFilters}
          isMobile={isMobile}
          onScopeChange={setSelectedScopeKeys}
          onParticipantStatusesChange={(scopeKey, statuses) =>
            setParticipantStatusesByApplication((current) => ({
              ...(current ?? {}),
              [scopeKey]: statuses,
            }))
          }
        />
        <TabsContent value={activePhase} className="mt-4 space-y-4">
          {activePhase === "before" && (
            <>
              <BeforePanel
                applicationId={selectedApplicationId}
                layoutKey={layoutKey}
                stats={applicationStats}
                loading={beforeLoading || scopesLoading}
                error={beforeError}
                editMode={editMode}
                onRetry={loadBefore}
              />
              {canManageStatistics && activeScopeFilters.length === 1 && (
                <StatsVisibility scopeKey={activeScopeFilters[0]} />
              )}
            </>
          )}
          {activePhase === "during" && (
            <DuringPanel stats={liveStats} mealPlans={mealPlans.data?.meals ?? []} />
          )}
          {activePhase === "after" && (
            <AfterPanel
              stats={liveStats.data}
              applicationStats={applicationStats}
              hours={hours}
              loading={afterLoading}
              error={afterError}
              onRetry={loadAfter}
            />
          )}
        </TabsContent>
      </Tabs>
    </PageLayout>
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
