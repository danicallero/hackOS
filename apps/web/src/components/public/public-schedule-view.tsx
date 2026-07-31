"use client";

import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

/**
 * The public schedule combines the event and activity reads required by H47.
 * Each read has its own retryable failure state so a rejected request cannot
 * leave the public page in an infinite loading state. `/timetable` and
 * `/horario` are the same page written twice and only differ in their shell,
 * so the shell is all they keep — the app route wraps it in `PageHeader`, the
 * public route in its own `Brand` header.
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
  const [eventLoading, setEventLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const loadEvent = useCallback(async () => {
    setEventLoading(true);
    setEventError(null);
    try {
      setEvent(await api.get<PublicEvent>("/api/public/event"));
    } catch (error) {
      setEventError(error instanceof ApiError ? error.message : t("publicEventUnavailable"));
    } finally {
      setEventLoading(false);
    }
  }, [t]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      setItems((await logisticsApi.publicSchedule()).items);
    } catch (error) {
      setScheduleError(error instanceof ApiError ? error.message : t("couldNotLoadSchedule"));
    } finally {
      setScheduleLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void Promise.all([loadEvent(), loadSchedule()]);
  }, [loadEvent, loadSchedule]);

  return (
    <>
      {header?.(event)}
      {eventLoading || scheduleLoading ? (
        <div className="flex justify-center py-20" role="status" aria-busy="true">
          <Spinner className="size-6" />
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : eventError || scheduleError ? (
        <div className="space-y-4">
          {eventError && <ContextualError message={eventError} onRetry={() => void loadEvent()} />}
          {scheduleError && (
            <ContextualError message={scheduleError} onRetry={() => void loadSchedule()} />
          )}
        </div>
      ) : (
        event && items && <ScheduleTimeline items={items} timezone={event.timezone} />
      )}
    </>
  );
}
