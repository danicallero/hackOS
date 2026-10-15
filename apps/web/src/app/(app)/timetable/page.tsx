"use client";

import { PageLayout } from "@/components/common/page-layout";
import { HomeSectionHeader } from "@/components/common/section-navigation";
import { PublicScheduleView } from "@/components/public/public-schedule-view";

export default function TimetablePage() {
  return (
    <PageLayout>
      <PublicScheduleView
        header={(_event, actions) => (
          <>
            <HomeSectionHeader />
            {actions && <div className="flex justify-end gap-2">{actions}</div>}
          </>
        )}
      />
    </PageLayout>
  );
}
