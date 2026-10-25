"use client";

import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { HomeSectionHeader } from "@/components/common/section-navigation";
import { PublicScheduleView } from "@/components/public/public-schedule-view";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

/** Same route for everyone: signed-out visitors get the schedule without the personal area. */
export default function TimetablePage() {
  const { t } = useLocale();
  const { status } = useSessionContext();
  return (
    <PageLayout>
      <PublicScheduleView
        header={(_event, actions) => (
          <>
            {status === "authenticated" ? (
              <HomeSectionHeader />
            ) : (
              <PageHeader title={t("schedule")} reserveNavigation={false} />
            )}
            {actions && <div className="flex justify-end gap-2">{actions}</div>}
          </>
        )}
      />
    </PageLayout>
  );
}
