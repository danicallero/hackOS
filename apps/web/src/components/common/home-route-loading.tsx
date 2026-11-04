"use client";

import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { HomeSectionHeader } from "@/components/common/section-navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/**
 * H55: route fallback for the Home tabs. The title and tab bar are shared
 * chrome, so they stay put while only the content below them is a skeleton.
 */
export function HomeRouteLoading({ publicTitleKey }: { publicTitleKey?: "schedule" }) {
  const { t } = useLocale();
  const { status } = useSessionContext();
  return (
    <PageLayout>
      {status === "authenticated" ? (
        <HomeSectionHeader />
      ) : publicTitleKey ? (
        <PageHeader title={t(publicTitleKey)} reserveNavigation={false} />
      ) : null}
      <div
        role="status"
        aria-busy="true"
        aria-label={t("loading")}
        className="loading-delayed space-y-4"
      >
        <Skeleton className="h-9 w-full" aria-hidden="true" />
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    </PageLayout>
  );
}
