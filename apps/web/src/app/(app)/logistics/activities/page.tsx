"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { ActivityScannerCard } from "@/components/logistics/activity-scanner";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";

export default function ActivitiesPage() {
  const { t } = useLocale();
  const canScan = useCan(CAPABILITIES.ACTIVITY_SCAN);

  if (!canScan) {
    return <AccessDenied ask={t("activitiesDeniedDesc")} />;
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("activities")} />
      <ActivityScannerCard category="activity" />
    </div>
  );
}
