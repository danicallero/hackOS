"use client";

import { PageHeader } from "@/components/common/page-header";
import { PublicScheduleView } from "@/components/public/public-schedule-view";
import { useLocale } from "@/lib/i18n";

export default function TimetablePage() {
  const { t } = useLocale();

  return (
    <div className="space-y-8">
      <PublicScheduleView
        header={(event) => <PageHeader context={event?.name ?? "hackOS"} title={t("schedule")} />}
      />
    </div>
  );
}
