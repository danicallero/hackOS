"use client";

import { type ActivityKind, activityKindLabelKey } from "@hackos/shared/activity-kinds";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Spinner } from "@/components/common/spinner";
import type { PublicEvent } from "@/components/public/public-types";
import {
  deriveViewerScheduleSegments,
  matchesScheduleSegmentFilter,
  segmentLabel,
  type ViewerScheduleSegment,
} from "@/components/public/schedule-audience-filter";
import {
  deriveScheduleKinds,
  matchesScheduleKindFilter,
} from "@/components/public/schedule-kind-filter";
import { ScheduleTimeline } from "@/components/public/schedule-timeline";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, resolveScheduleText } from "@/lib/logistics";

/**
 * The public schedule combines the event and activity reads required by H47.
 * Each read has its own retryable failure state so a rejected request cannot
 * leave the public page in an infinite loading state. `/timetable` is the one
 * route for signed-in and signed-out viewers; only its header differs.
 *
 * `header` is a title slot rather than a plain node because both shells title
 * themselves with the event name, which only this component has loaded.
 * Search and categorical filters are owned here so both shells share controls.
 */
export function PublicScheduleView({
  header,
}: {
  header?: (event: PublicEvent | null, actions: React.ReactNode) => React.ReactNode;
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
  const [search, setSearch] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [kindFilter, setKindFilter] = useState<Set<ActivityKind>>(new Set());

  const loadEvent = useCallback(async () => {
    setEventLoading(true);
    setEventError(null);
    try {
      setEvent(await api.get<PublicEvent>("/api/public/event"));
    } catch (error) {
      setEventError(apiErrorText(error, t, t("publicEventUnavailable")));
    } finally {
      setEventLoading(false);
    }
  }, [t]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      const { items } = await logisticsApi.viewerSchedule();
      // Resolve each item's title/description into the viewer's language here
      // (H50 extension) so ScheduleTimeline and everything downstream can
      // keep reading plain item.title/item.description unchanged.
      setItems(items.map((item) => ({ ...item, ...resolveScheduleText(item, language) })));
    } catch (error) {
      setScheduleError(apiErrorText(error, t, t("couldNotLoadSchedule")));
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
          matchesScheduleKindFilter(item, kindFilter) &&
          (!locations.length || locations.includes(item.location ?? "")) &&
          `${item.title} ${item.description ?? ""} ${item.location ?? ""}`
            .toLocaleLowerCase(language)
            .includes(search.trim().toLocaleLowerCase(language)),
      ) ?? null,
    [items, segmentFilter, kindFilter, locations, search, language],
  );
  const filters: FilterDefinition[] = [
    ...(availableKinds.length > 1
      ? [
          {
            id: "kind",
            label: t("scheduleKindColumn"),
            icon: CalendarDotsIcon,
            type: "multiple" as const,
            value: [...kindFilter],
            onChange: (values: string[]) => setKindFilter(new Set(values as ActivityKind[])),
            options: availableKinds.map((kind) => ({
              value: kind,
              label: t(activityKindLabelKey(kind)),
              color: `var(--schedule-${kind})`,
            })),
          },
        ]
      : []),
    ...(availableSegments.length > 0
      ? [
          {
            id: "audience",
            label: t("audienceFilterAction"),
            icon: UsersIcon,
            type: "multiple" as const,
            value: [...segmentFilter],
            onChange: (values: string[]) =>
              setSegmentFilter(new Set(values as ViewerScheduleSegment[])),
            options: availableSegments.map((segment) => ({
              value: segment,
              label: segmentLabel(segment, t),
            })),
          },
        ]
      : []),
    {
      id: "location",
      label: t("locationLabel"),
      icon: MapPinIcon,
      type: "multiple" as const,
      value: locations,
      onChange: setLocations,
      options: [
        ...new Set(
          (items ?? [])
            .map((item) => item.location)
            .filter((location): location is string => Boolean(location)),
        ),
      ]
        .sort()
        .map((location) => ({ value: location, label: location })),
    },
  ].filter((filter) => filter.options.length > 0);

  return (
    <>
      {header?.(event, null)}
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
          /* showResponsible is safe unconditionally: the API only ever
             includes contactNote/owners for callers entitled to see them
             (staff, or a sponsor rep on their own sponsor-tagged items) —
             this page reuses that same /api/public/activities payload for
             /timetable for every viewer, so a sponsor rep landing here
             (the "schedule" nav item has no sponsor gate) still sees the
             contact info the API already sent, matching sponsor-faq. */
          <ScheduleTimeline
            renderToolbar={(controls) => (
              <ListToolbar
                search={{
                  label: t("search"),
                  placeholder: t("searchSchedulePlaceholder"),
                  value: search,
                  onValueChange: setSearch,
                }}
                filters={filters}
                actions={<div className="col-span-full md:col-span-1">{controls}</div>}
              />
            )}
            rangeItems={items ?? undefined}
            items={displayedItems}
            timezone={event.timezone}
            showResponsible
            emptyTitle={
              items && items.length > 0 && displayedItems.length === 0
                ? t("scheduleFilterNoMatches")
                : undefined
            }
          />
        )
      )}
    </>
  );
}
