"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { TabBar } from "@/components/common/tab-bar";
import { ActivityScannerCard } from "@/components/logistics/activity-scanner";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";

// Meals and activities are the same station shape (H22-H27: gated by the
// same activity:scan capability, both wrapping ActivityScannerCard with a
// different category) — merged into one page the same way accreditation and
// presence share /logistics/presence.
const ACTIVITY_STATION_TABS = ["activity", "meal"] as const;
type ActivityStationTab = (typeof ACTIVITY_STATION_TABS)[number];

export default function ActivitiesPage() {
  const { t } = useLocale();
  const canScan = useCan(CAPABILITIES.ACTIVITY_SCAN);
  const { tab, setTab } = useUrlTab<ActivityStationTab>({
    values: ACTIVITY_STATION_TABS,
    defaultValue: "activity",
  });

  if (!canScan) {
    return <AccessDenied ask={t("activitiesDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("mealsAndActivities")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        <TabBar aria-label={t("mealsAndActivities")} className="w-full justify-start">
          <TabsTrigger value="activity">{t("activities")}</TabsTrigger>
          <TabsTrigger value="meal">{t("meals")}</TabsTrigger>
        </TabBar>
      </Tabs>

      {tab === "activity" ? (
        <ActivityScannerCard category="activity" />
      ) : (
        <ActivityScannerCard category="meal" />
      )}
    </div>
  );
}
