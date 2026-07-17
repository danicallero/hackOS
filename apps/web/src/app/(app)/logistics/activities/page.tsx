"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActivityScannerCard } from "@/components/logistics/activity-scanner";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";

export default function ActivitiesPage() {
  const { t } = useLocale();
  const canScan = useCan(CAPABILITIES.ACTIVITY_SCAN);

  if (!canScan) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("activities")} />
        <EmptyState
          icon={LockIcon}
          title={t("activitiesDeniedTitle")}
          description={t("activitiesDeniedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("activities")} />
      <ActivityScannerCard category="activity" />
    </div>
  );
}
