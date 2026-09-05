"use client";

import type { ActivityKind } from "@hackos/shared/activity-kinds";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import {
  deriveViewerScheduleSegments,
  matchesScheduleSegmentFilter,
  ScheduleAudienceFilterPopover,
  type ViewerScheduleSegment,
} from "@/components/public/schedule-audience-filter";
import {
  deriveScheduleKinds,
  matchesScheduleKindFilter,
  ScheduleKindFilterPopover,
} from "@/components/public/schedule-kind-filter";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, resolveScheduleText } from "@/lib/logistics";

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
  const { t, language } = useLocale();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // The viewer's own audience filter (H59 follow-up) — options are exactly
  // the segments actually present in what this caller received, never a
  // static list, so it's always as permissive (and no more) as their real
  // access. See schedule-audience-filter.tsx.
  const [segmentFilter, setSegmentFilter] = useState<Set<ViewerScheduleSegment>>(new Set());
  // Companion filter by activity kind (talk/workshop/meal/…) — independent of
  // the audience filter above, so a viewer can combine "just mentor items"
  // with "just workshops" instead of picking one axis.
  const [kindFilter, setKindFilter] = useState<Set<ActivityKind>>(new Set());

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
      const { items } = await logisticsApi.publicSchedule();
      // Resolve each item's title/description into the viewer's language here
      // (H50 extension) so ScheduleTimeline and everything downstream can
      // keep reading plain item.title/item.description unchanged.
      setItems(items.map((item) => ({ ...item, ...resolveScheduleText(item, language) })));
    } catch (error) {
      setScheduleError(error instanceof ApiError ? error.message : t("couldNotLoadSchedule"));
    } finally {
      setScheduleLoading(false);
    }
  }, [t, language]);

  // Fetch event and schedule on mount or language change; callbacks manage independent
  // error/loading states for decoupled failure recovery, making setState expected here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([loadEvent(), loadSchedule()]);
  }, [loadEvent, loadSchedule]);

  const availableSegments = useMemo(() => deriveViewerScheduleSegments(items ?? []), [items]);
  const availableKinds = useMemo(() => deriveScheduleKinds(items ?? []), [items]);
  const displayedItems = useMemo(
    () =>
      items?.filter(
        (item) =>
          matchesScheduleSegmentFilter(item, segmentFilter) &&
          matchesScheduleKindFilter(item, kindFilter),
      ) ?? null,
    [items, segmentFilter, kindFilter],
  );

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
        event &&
        displayedItems && (
          <div className="space-y-4">
            {/* A single segment means every item the caller can see already
                shares it (e.g. a pure participant) — nothing meaningful to
                filter, so the control only appears once there's a real
                choice (H59 follow-up). Same reasoning for kinds: only one
                kind present means there's nothing to narrow down. */}
            {(availableSegments.length > 1 || availableKinds.length > 1) && (
              <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                {availableSegments.length > 1 && (
                  <ScheduleAudienceFilterPopover
                    segments={availableSegments}
                    selected={segmentFilter}
                    onChange={setSegmentFilter}
                  />
                )}
                {availableKinds.length > 1 && (
                  <ScheduleKindFilterPopover
                    kinds={availableKinds}
                    selected={kindFilter}
                    onChange={setKindFilter}
                  />
                )}
              </div>
            )}
            {/* showResponsible is safe unconditionally: the API only ever
                includes contactNote/owners for callers entitled to see them
                (staff, or a sponsor rep on their own sponsor-tagged items) —
                this page reuses that same /api/public/activities payload for
                both /timetable and /horario, so a sponsor rep landing here
                (the "schedule" nav item has no sponsor gate) still sees the
                contact info the API already sent, matching sponsor-faq. */}
            <ScheduleTimeline
              items={displayedItems}
              timezone={event.timezone}
              showResponsible
              emptyTitle={
                items && items.length > 0 && displayedItems.length === 0
                  ? t("scheduleFilterNoMatches")
                  : undefined
              }
            />
          </div>
        )
      )}
    </>
  );
}
