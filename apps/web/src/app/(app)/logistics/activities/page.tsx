"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { LockIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActivityScannerCard } from "@/components/logistics/activity-scanner";
import { useCan } from "@/lib/session";

export default function ActivitiesPage() {
  const canScan = useCan(CAPABILITIES.ACTIVITY_SCAN);

  if (!canScan) {
    return (
      <div className="space-y-6">
        <PageHeader title="Activities" />
        <EmptyState
          icon={LockIcon}
          title="You can't scan activities"
          description="The activity scan capability is required."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Activities"
        description="Register attendance at talks, workshops and other scannable activities (H26)."
      />
      <ActivityScannerCard category="activity" />
    </div>
  );
}
