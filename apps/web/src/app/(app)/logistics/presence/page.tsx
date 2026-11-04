"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { PresenceExportPanel } from "@/components/exports/presence-export-panel";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-event-source";
import { useLocale } from "@/lib/i18n";
import {
  type AccreditationRoleCount,
  logisticsApi,
  type OpenPresenceSession,
  type PresenceEstimate,
  type PresenceHours,
} from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { AttendanceCertificatesTab } from "./certificates-tab";
import { HoursTab } from "./hours-tab";
import { PeopleTab } from "./people-tab";
import { ScanTab } from "./scan-tab";
import { SessionsTab } from "./sessions-tab";
import { queryLoadError } from "./shared";

const PRESENCE_TABS = ["scan", "people", "sessions", "hours", "certificates"] as const;
type PresenceTab = (typeof PRESENCE_TABS)[number];

const PRESENCE_EVENTS = [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN];

export default function PresencePage() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canAccredit = useCan(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const canManage = useCan(CAPABILITIES.PRESENCE_MANAGE);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const { tab, setTab } = useUrlTab<PresenceTab>({
    values: PRESENCE_TABS,
    defaultValue: canManage && !canAccredit && !canPresence ? "certificates" : "scan",
  });

  const [sessionCount, setSessionCount] = useState(0);
  const [roleCounts, setRoleCounts] = useState<AccreditationRoleCount[]>([]);
  const loadAccreditationCounts = useCallback(() => {
    void logisticsApi.accreditationStats().then((result) => setRoleCounts(result.byRole));
  }, []);
  useEffect(() => {
    if (canAccredit) loadAccreditationCounts();
  }, [canAccredit, loadAccreditationCounts]);

  const estimate = useLiveQuery<PresenceEstimate>(
    logisticsApi.presenceEstimate,
    REALTIME_SCOPES.LOGISTICS,
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400, resourceKey: ["logistics", "presence", "estimate"] },
  );
  const hours = useLiveQuery<PresenceHours[]>(
    logisticsApi.presenceHours,
    REALTIME_SCOPES.LOGISTICS,
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400, resourceKey: ["logistics", "presence", "hours"] },
  );
  const openSessions = useLiveQuery<OpenPresenceSession[]>(
    async () => (await logisticsApi.presenceOpenSessions()).items,
    REALTIME_SCOPES.LOGISTICS,
    PRESENCE_EVENTS,
    {
      enabled: canPresence,
      debounceMs: 400,
      resourceKey: ["logistics", "presence", "open-sessions"],
    },
  );

  // H24/H27: each read model keeps its own failure and retry path so one
  // outage cannot make another operational dataset look empty or unknown.
  const estimateError = queryLoadError(
    estimate.error,
    t,
    t("attendanceDataUnavailable"),
    estimate.refetch,
  );
  const hoursError = queryLoadError(hours.error, t, t("couldNotLoadStatistics"), hours.refetch);
  const openSessionsError = queryLoadError(
    openSessions.error,
    t,
    t("attendanceDataUnavailable"),
    openSessions.refetch,
  );

  const openPersonFromDirectory = useCallback(
    (userId: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "scan");
      params.set("userId", String(userId));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!canAccredit && !canPresence && !canStats && !canManage) {
    return <AccessDenied ask={t("presenceDeniedDesc")} />;
  }

  return (
    <PageLayout>
      <PageHeader
        title={t("accreditationAndPresence")}
        secondaryActions={canStats ? <PresenceExportPanel /> : undefined}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value)}
        className="gap-(--page-section-gap)"
      >
        <TabBar aria-label={t("presenceSections")}>
          {canManage && <TabsTrigger value="certificates">{t("certificates")}</TabsTrigger>}
          <TabsTrigger value="scan">{t("presenceScanTab")}</TabsTrigger>
          <TabsTrigger value="people">{t("peopleTab")}</TabsTrigger>
          {canPresence && <TabsTrigger value="sessions">{t("presenceSessionsTab")}</TabsTrigger>}
          {canPresence && <TabsTrigger value="hours">{t("presenceHoursTab")}</TabsTrigger>}
        </TabBar>
        {/* Mount the active panel so each trigger's aria-controls resolves (#1177). */}
        <TabsContent value={tab} className="space-y-(--page-section-gap)">
          {tab === "scan" && canAccredit && (
            <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div className="flex items-baseline gap-3">
                <dt className="text-sm">
                  {t("checkedInSession")}
                  <span className="text-muted-foreground ml-2 text-xs">{t("onThisDevice")}</span>
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">{sessionCount}</dd>
              </div>
              {roleCounts.map((item) => (
                <div key={item.role ?? "unassigned"} className="flex items-baseline gap-2">
                  <dt className="text-muted-foreground text-sm">
                    {item.role ?? t("roleUnassigned")} · {t("accredited")}
                  </dt>
                  <dd className="text-lg tabular-nums">{item.count}</dd>
                </div>
              ))}
            </dl>
          )}

          {tab === "scan" && (canAccredit || canPresence) && (
            <ScanTab
              canAccredit={canAccredit}
              canPresence={canPresence}
              onAccredited={() => {
                setSessionCount((n) => n + 1);
                loadAccreditationCounts();
              }}
              onPresenceScanned={() => {
                estimate.refetch();
                hours.refetch();
                openSessions.refetch();
              }}
            />
          )}

          {tab === "certificates" && canManage && <AttendanceCertificatesTab />}

          {tab === "people" && <PeopleTab onOpenPerson={openPersonFromDirectory} />}

          {tab === "hours" && canPresence && (
            <HoursTab hours={hours.data ?? []} loading={hours.loading} hoursError={hoursError} />
          )}

          {tab === "sessions" && canPresence && (
            <SessionsTab
              presentCount={estimate.data?.presentCount}
              estimateConnected={estimate.connected}
              estimateError={estimateError}
              sessions={openSessions.data ?? []}
              loading={openSessions.loading}
              sessionsError={openSessionsError}
            />
          )}
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
