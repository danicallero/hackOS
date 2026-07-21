"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

export default function TimetablePage() {
  const { t } = useLocale();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);

  useEffect(() => {
    void Promise.all([
      api.get<PublicEvent>("/api/public/event"),
      logisticsApi.publicSchedule(),
    ]).then(([eventResult, scheduleResult]) => {
      setEvent(eventResult);
      setItems(scheduleResult.items);
    });
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader title={t("schedule")} description={event?.name ?? "hackOS"} />
      {items === null || event === null ? (
        <div className="flex justify-center py-20" role="status" aria-busy="true">
          <Spinner className="size-6" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : (
        <ScheduleTimeline items={items} timezone={event.timezone} />
      )}
    </div>
  );
}
