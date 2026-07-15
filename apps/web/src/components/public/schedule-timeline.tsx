"use client";

import { CalendarDaysIcon, Clock3Icon, MapPinIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 72;
const MIN_ITEM_HEIGHT = 52;
const LANE_GAP = 8;

interface PositionedItem {
  item: PublicScheduleItem;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
}

/**
 * Calendar entries are absolutely positioned, so their collision lanes must
 * be based on rendered pixels (including the minimum readable card height),
 * not only on their timestamps.
 */
function positionDayItems(items: PublicScheduleItem[], rangeStart: number): PositionedItem[] {
  const positioned = items
    .map((item) => {
      const starts = Date.parse(item.startsAt);
      const ends = Date.parse(item.endsAt);
      return {
        item,
        top: ((starts - rangeStart) / 3_600_000) * HOUR_HEIGHT,
        height: Math.max(MIN_ITEM_HEIGHT, ((ends - starts) / 3_600_000) * HOUR_HEIGHT - 4),
      };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const result: PositionedItem[] = [];
  let group: typeof positioned = [];
  let groupBottom = Number.NEGATIVE_INFINITY;

  const placeGroup = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.top);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = entry.top + entry.height;
      return { ...entry, lane };
    });
    const laneCount = laneEnds.length;
    result.push(...placed.map((entry) => ({ ...entry, laneCount })));
  };

  for (const entry of positioned) {
    if (group.length && entry.top >= groupBottom) {
      placeGroup();
      group = [];
      groupBottom = Number.NEGATIVE_INFINITY;
    }
    group.push(entry);
    groupBottom = Math.max(groupBottom, entry.top + entry.height);
  }
  placeGroup();
  return result;
}

function startOfHour(value: number) {
  const date = new Date(value);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function endOfHour(value: number) {
  return startOfHour(value) + 60 * 60_000;
}

function dayKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export function ScheduleTimeline({
  items,
  timezone,
  className,
}: {
  items: PublicScheduleItem[];
  timezone: string;
  className?: string;
}) {
  const { language, t } = useLocale();
  const now = Date.now();
  const focusRef = useRef<HTMLElement | null>(null);
  const [selectedItem, setSelectedItem] = useState<PublicScheduleItem | null>(null);
  const ordered = useMemo(
    () => [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [items],
  );
  const days = useMemo(() => {
    const grouped = new Map<string, PublicScheduleItem[]>();
    for (const item of ordered) {
      const key = dayKey(item.startsAt, timezone);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [ordered, timezone]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, []);

  if (!ordered.length) {
    return (
      <EmptyState
        icon={CalendarDaysIcon}
        title={t("schedulePending")}
        description={t("noUpcomingSchedule")}
      />
    );
  }

  const dateFormatter = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  const currentDay = dayKey(new Date(now).toISOString(), timezone);
  const firstFutureId = ordered.find((item) => Date.parse(item.endsAt) >= now)?.id;

  return (
    <div className={cn("space-y-10", className)}>
      {days.map(([key, dayItems]) => {
        const first = Math.min(...dayItems.map((item) => Date.parse(item.startsAt)));
        const last = Math.max(...dayItems.map((item) => Date.parse(item.endsAt)));
        const rangeStart = startOfHour(first);
        const rangeEnd = endOfHour(last);
        const height = ((rangeEnd - rangeStart) / 3_600_000) * HOUR_HEIGHT;
        const isToday = key === currentDay;
        const showNow = isToday && now >= rangeStart && now <= rangeEnd;
        const hours = Array.from(
          { length: Math.ceil((rangeEnd - rangeStart) / 3_600_000) + 1 },
          (_, index) => rangeStart + index * 3_600_000,
        );
        const positionedItems = positionDayItems(dayItems, rangeStart);

        return (
          <section key={key} aria-labelledby={`schedule-day-${key}`}>
            <div className="mb-4 flex items-center gap-2">
              <h2
                id={`schedule-day-${key}`}
                className="text-balance text-xl font-semibold capitalize"
              >
                {dateFormatter.format(new Date(first))}
              </h2>
              {isToday && (
                <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                  {t("today")}
                </span>
              )}
            </div>
            <div className="relative ml-1" style={{ height }}>
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="border-border/70 absolute inset-x-0 border-t"
                  style={{ top: index * HOUR_HEIGHT }}
                >
                  <time className="text-muted-foreground absolute -top-2.5 left-0 w-14 bg-background pr-2 text-right text-xs tabular-nums">
                    {timeFormatter.format(new Date(hour))}
                  </time>
                </div>
              ))}

              <ol className="absolute inset-0 left-16">
                {positionedItems.map(({ item, top, height: itemHeight, lane, laneCount }) => {
                  const starts = Date.parse(item.startsAt);
                  const ends = Date.parse(item.endsAt);
                  const active = starts <= now && ends >= now;
                  const passed = ends < now;
                  const shouldFocus = active || (!showNow && item.id === firstFutureId);
                  const width = `calc(${100 / laneCount}% - ${(LANE_GAP * (laneCount - 1)) / laneCount}px)`;
                  const left = `calc(${(lane * 100) / laneCount}% + ${(lane * LANE_GAP) / laneCount}px)`;
                  return (
                    <li
                      key={item.id}
                      ref={
                        shouldFocus
                          ? (node) => {
                              focusRef.current = node;
                            }
                          : undefined
                      }
                      className={cn(
                        "absolute overflow-hidden rounded-lg border bg-card shadow-sm",
                        active && "border-primary bg-primary/5",
                        passed && "opacity-60",
                      )}
                      style={{ top, height: itemHeight, left, width }}
                    >
                      <button
                        type="button"
                        className="size-full cursor-pointer px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-medium">{item.title}</h3>
                            <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                <Clock3Icon className="size-3" aria-hidden="true" />
                                {timeFormatter.format(new Date(starts))}–
                                {timeFormatter.format(new Date(ends))}
                              </span>
                              {item.location && (
                                <span className="inline-flex min-w-0 items-center gap-1 truncate">
                                  <MapPinIcon className="size-3 shrink-0" aria-hidden="true" />
                                  {item.location}
                                </span>
                              )}
                            </p>
                          </div>
                          {active && (
                            <span className="text-primary shrink-0 text-xs font-medium">
                              {t("happeningNow")}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {showNow && (
                <div
                  ref={(node) => {
                    focusRef.current = node;
                  }}
                  className="pointer-events-none absolute right-0 left-14 z-10 flex items-center"
                  style={{ top: ((now - rangeStart) / 3_600_000) * HOUR_HEIGHT }}
                  role="status"
                  aria-label={t("currentTime")}
                >
                  <span className="bg-primary size-2.5 rounded-full" />
                  <span className="bg-primary h-0.5 flex-1" />
                  <span className="bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                    {timeFormatter.format(new Date(now))}
                  </span>
                </div>
              )}
            </div>
          </section>
        );
      })}
      <Modal
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
        title={selectedItem?.title ?? ""}
        description={
          selectedItem
            ? `${dateFormatter.format(new Date(selectedItem.startsAt))} · ${timeFormatter.format(new Date(selectedItem.startsAt))}–${timeFormatter.format(new Date(selectedItem.endsAt))}`
            : undefined
        }
        icon={CalendarDaysIcon}
      >
        {selectedItem && (
          <div className="space-y-4 text-sm">
            {selectedItem.location && (
              <p className="text-muted-foreground flex items-start gap-2 text-pretty">
                <MapPinIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {selectedItem.location}
              </p>
            )}
            {selectedItem.type && (
              <p className="text-muted-foreground capitalize">{selectedItem.type}</p>
            )}
            {selectedItem.description && (
              <p className="whitespace-pre-wrap text-pretty">{selectedItem.description}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
