"use client";

import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/** First station a user can reach, in operator-priority order. */
const STATIONS: { href: string; capability: Capability }[] = [
  { href: "/logistics/accreditation", capability: CAPABILITIES.ACCREDIT_SCAN },
  { href: "/logistics/meals", capability: CAPABILITIES.ACTIVITY_SCAN },
  { href: "/logistics/presence", capability: CAPABILITIES.PRESENCE_SCAN },
  { href: "/logistics/stats", capability: CAPABILITIES.LOGISTICS_STATS },
];

/**
 * Logistics is split into per-station pages (H22-H27). This legacy entry point
 * redirects to the first station the operator can access so old links resolve.
 */
export default function LogisticsIndexPage() {
  const router = useRouter();
  const { t } = useLocale();
  const { status, can } = useSessionContext();
  const target = STATIONS.find((s) => can(s.capability))?.href;

  useEffect(() => {
    if (status === "loading") return;
    if (target) router.replace(target);
  }, [status, target, router]);

  if (status !== "loading" && !target) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("logistics")} />
        <EmptyState
          icon={LockIcon}
          title={t("logisticsDeniedTitle")}
          description={t("logisticsDeniedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-6" />
    </div>
  );
}
