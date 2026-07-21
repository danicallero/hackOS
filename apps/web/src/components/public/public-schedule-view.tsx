"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

/**
 * The public schedule: one fetch, one loading state, one timeline render
 * (issue #301). `/timetable` and `/horario` were the same page written twice
 * and only differ in their shell, so the shell is all they keep — the app
 * route wraps it in `PageHeader`, the public route in its own `Brand` header.
 *
 * `header` is a title slot rather than a plain node because both shells title
 * themselves with the event name, which only this component has loaded.
 */
export function PublicScheduleView({
  header,
}: {
  header?: (event: PublicEvent | null) => React.ReactNode;
}) {
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
    <>
      {header?.(event)}
      {items === null || event === null ? (
        <div className="flex justify-center py-20" role="status" aria-busy="true">
          <Spinner className="size-6" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : (
        <ScheduleTimeline items={items} timezone={event.timezone} />
      )}
    </>
  );
}
