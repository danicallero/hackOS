"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { DietaryOverview } from "@/components/logistics/dietary-overview";
import { RsvpOverview } from "@/components/logistics/rsvp-overview";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";

const TABS = ["activities", "dietary"] as const;
type Tab = (typeof TABS)[number];

/** Attendance per activity, and every dietary restriction with its notes (meal-plans:export). */
export default function RsvpsPage() {
  const { t } = useLocale();
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const canDietary = useCan(CAPABILITIES.MEAL_PLANS_EXPORT);
  const tabs = TABS.filter((tab) => (tab === "activities" ? canStats : canDietary));
  const { tab, setTab } = useUrlTab<Tab>({
    values: tabs,
    defaultValue: tabs[0] ?? "activities",
  });
  if (tabs.length === 0) return <AccessDenied ask={t("logisticsDeniedDesc")} />;
  return (
    <PageLayout width="content">
      <PageHeader title={t("rsvpOverviewTitle")} />
      <Tabs value={tab} onValueChange={(value) => setTab(value)}>
        {tabs.length > 1 && (
          <TabBar aria-label={t("rsvpOverviewTitle")}>
            {tabs.map((item) => (
              <TabsTrigger key={item} value={item}>
                {t(item === "activities" ? "rsvpTabActivities" : "rsvpTabDietary")}
              </TabsTrigger>
            ))}
          </TabBar>
        )}
      </Tabs>
      {tab === "dietary" ? <DietaryOverview /> : <RsvpOverview />}
    </PageLayout>
  );
}
