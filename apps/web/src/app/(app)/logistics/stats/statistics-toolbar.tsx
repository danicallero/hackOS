"use client";

import type { StatisticsParticipantStatus } from "@hackos/shared/statistics";
import { TabBar } from "@/components/common/tab-bar";
import { StatisticsScopeFilterMenu } from "@/components/statistics/statistics-scope-filter-menu";
import { TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import type { DataPhase, StatisticsScope } from "./model";

export function StatisticsToolbar({
  activePhase,
  canGeneralStats,
  scopes,
  selectedScopeKeys,
  participantStatusesByApplication,
  isMobile,
  onScopeChange,
  onParticipantStatusesChange,
}: {
  activePhase: DataPhase;
  canGeneralStats: boolean;
  scopes: StatisticsScope[];
  selectedScopeKeys: string[];
  participantStatusesByApplication: Record<string, StatisticsParticipantStatus[]>;
  isMobile: boolean;
  onScopeChange: (keys: string[]) => void;
  onParticipantStatusesChange: (scopeKey: string, statuses: StatisticsParticipantStatus[]) => void;
}) {
  const { t } = useLocale();
  const visibleScopes = activePhase === "before" ? scopes : [];
  const hasVisibleScopes = visibleScopes.length > 0;

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <TabBar width="content" aria-label={t("eventPhaseLabel")}>
        <TabsTrigger value="before">{t("phaseBefore")}</TabsTrigger>
        {canGeneralStats && <TabsTrigger value="during">{t("phaseDuring")}</TabsTrigger>}
        {canGeneralStats && <TabsTrigger value="after">{t("phaseAfter")}</TabsTrigger>}
      </TabBar>
      {hasVisibleScopes && (
        <StatisticsScopeFilterMenu
          className="contents"
          chipsClassName="col-span-full row-start-2 min-w-0 max-w-full flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1"
          scopes={visibleScopes}
          selectedScopeKeys={selectedScopeKeys}
          participantStatusesByApplication={participantStatusesByApplication}
          onScopeChange={onScopeChange}
          onParticipantStatusesChange={onParticipantStatusesChange}
          iconOnly={isMobile}
        />
      )}
    </div>
  );
}
