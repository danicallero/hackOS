"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { BadgeCheckIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
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
import { HoursTab } from "./hours-tab";
import { PeopleTab } from "./people-tab";
import { ScanTab } from "./scan-tab";
import { SessionsTab } from "./sessions-tab";
import { queryLoadError } from "./shared";

const PRESENCE_TABS = ["scan", "people", "sessions", "hours"] as const;
type PresenceTab = (typeof PRESENCE_TABS)[number];

const PRESENCE_EVENTS = [EVENTS.LOGISTICS_PRESENCE_SCAN, EVENTS.LOGISTICS_ACTIVITY_SCAN];

export default function PresencePage() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canAccredit = useCan(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const { tab, setTab } = useUrlTab<PresenceTab>({
    values: PRESENCE_TABS,
    defaultValue: "scan",
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
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const hours = useLiveQuery<PresenceHours[]>(
    logisticsApi.presenceHours,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );
  const openSessions = useLiveQuery<OpenPresenceSession[]>(
    async () => (await logisticsApi.presenceOpenSessions()).items,
    "/api/logistics/stream",
    PRESENCE_EVENTS,
    { enabled: canPresence, debounceMs: 400 },
  );

  // H24/H27: each read model keeps its own failure and retry path so one
  // outage cannot make another operational dataset look empty or unknown.
  const estimateError = queryLoadError(
    estimate.error,
    t("attendanceDataUnavailable"),
    estimate.refetch,
  );
  const hoursError = queryLoadError(hours.error, t("couldNotLoadStatistics"), hours.refetch);
  const openSessionsError = queryLoadError(
    openSessions.error,
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

  if (!canAccredit && !canPresence) {
    return <AccessDenied ask={t("presenceDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("accreditationAndPresence")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        <TabBar aria-label={t("presenceSections")} className="w-full justify-start">
          <TabsTrigger value="scan">{t("presenceScanTab")}</TabsTrigger>
          <TabsTrigger value="people">{t("peopleTab")}</TabsTrigger>
          {canPresence && <TabsTrigger value="sessions">{t("presenceSessionsTab")}</TabsTrigger>}
          {canPresence && <TabsTrigger value="hours">{t("presenceHoursTab")}</TabsTrigger>}
        </TabBar>
      </Tabs>

      {tab === "scan" && canAccredit && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard
            label={t("checkedInSession")}
            value={sessionCount}
            icon={BadgeCheckIcon}
            hint={t("onThisDevice")}
          />
          {roleCounts.map((item) => (
            <StatCard
              key={item.role ?? "unassigned"}
              label={item.role ?? t("roleUnassigned")}
              value={item.count}
              icon={BadgeCheckIcon}
              hint={t("accredited")}
            />
          ))}
        </div>
      )}

      {tab === "scan" && (
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
    </div>
  );
}
