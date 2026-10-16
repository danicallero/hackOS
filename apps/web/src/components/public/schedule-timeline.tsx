"use client";

import { activityKindLabelKey, toActivityKind } from "@hackos/shared/activity-kinds";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";

import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import { SCHEDULE_CATEGORY_STYLES } from "./schedule-category-styles";

const HOUR_HEIGHT = 96;
const LANE_GAP = 4;
interface PositionedItem {
  item: PublicScheduleItem;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
  laneSpan: number;
}
export function positionDayItems(
  items: PublicScheduleItem[],
  toY: (t: number) => number,
): PositionedItem[] {
  const positioned = items
    .map((item) => {
      const starts = Date.parse(item.startsAt);
      const ends = Date.parse(item.endsAt);
      const top = toY(starts);
      return {
        item,
        top,
        height: Math.max(24, toY(ends) - top - 4),
        starts,
        ends,
      };
    })
    .sort((a, b) => a.starts - b.starts || b.ends - a.ends);

  const result: PositionedItem[] = [];
  let group: typeof positioned = [];
  let groupBottom = Number.NEGATIVE_INFINITY;

  const placeGroup = () => {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map((entry) => {
      let lane = laneEnds.findIndex((end) => end <= entry.starts);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = entry.ends;
      return { ...entry, lane };
    });
    const laneCount = laneEnds.length;
    result.push(
      ...placed.map((entry) => {
        let laneSpan = 1;
        for (let candidate = entry.lane + 1; candidate < laneCount; candidate++) {
          if (
            placed.some(
              (other) =>
                other.lane === candidate && other.starts < entry.ends && other.ends > entry.starts,
            )
          )
            break;
          laneSpan++;
        }
        return { ...entry, laneCount, laneSpan };
      }),
    );
  };

  for (const entry of positioned) {
    if (group.length && entry.starts >= groupBottom) {
      placeGroup();
      group = [];
      groupBottom = Number.NEGATIVE_INFINITY;
    }
    group.push(entry);
    groupBottom = Math.max(groupBottom, entry.ends);
  }
  placeGroup();
  return result;
}

const nextDate = (key: string) =>
  new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** H47: a shared hour grid with bounded scrolling, day/week views and visible activity metadata. */
export function ScheduleTimeline({
  items,
  rangeItems,
  timezone,
  className,
  showResponsible = false,
  emptyTitle,
  renderToolbar,
}: {
  items: PublicScheduleItem[];
  rangeItems?: PublicScheduleItem[];
  timezone: string;
  className?: string;
  showResponsible?: boolean;
  emptyTitle?: string;
  renderToolbar?: (controls: React.ReactNode) => React.ReactNode;
}) {
  const { language, t } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<"day" | "week">("day");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<PublicScheduleItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const today = instantToWallClock(new Date(now).toISOString(), timezone).slice(0, 10);
  const source = rangeItems ?? items;
  const visibleIds = new Set(items.map((item) => item.id));
  const days = useMemo(() => {
    const grouped = new Map<string, PublicScheduleItem[]>();
    for (const item of [...source].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    )) {
      const first = instantToWallClock(item.startsAt, timezone).slice(0, 10);
      const last = instantToWallClock(item.endsAt, timezone).slice(0, 10);
      for (let day = first; day <= last; day = nextDate(day)) {
        const start = wallClockToInstant(`${day}T00:00`, timezone)!;
        const end = wallClockToInstant(`${nextDate(day)}T00:00`, timezone)!;
        const startsAt = new Date(
          Math.max(Date.parse(item.startsAt), Date.parse(start)),
        ).toISOString();
        const endsAt = new Date(Math.min(Date.parse(item.endsAt), Date.parse(end))).toISOString();
        if (startsAt < endsAt)
          grouped.set(day, [...(grouped.get(day) ?? []), { ...item, startsAt, endsAt }]);
      }
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [source, timezone]);
  const activeDay =
    days.find(([key]) => key === selectedDay) ?? days.find(([key]) => key === today) ?? days[0];
  const visible = view === "day" ? (activeDay ? [activeDay] : []) : days.slice(0, 7);
  const dateFormatter = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  });
  const shortDate = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  const timeFormatter = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
  const hour = (instant: string) => {
    const wall = instantToWallClock(instant, timezone);
    return Number(wall.slice(11, 13)) + Number(wall.slice(14, 16)) / 60;
  };
  const startHour = 0;
  const endHour = 24;
  const height = 24 * HOUR_HEIGHT;
  const nowHour = hour(new Date(now).toISOString());
  const showNow = visible.some(([key]) => key === today);
  const openItem = (item: PublicScheduleItem) =>
    setSelectedItem(items.find((original) => original.id === item.id) ?? item);
  function goToNow() {
    setSelectedDay(today);
    if (scroller.current)
      scroller.current.scrollTop = Math.max(
        0,
        (hour(new Date(now).toISOString()) - startHour) * HOUR_HEIGHT - 80,
      );
  }
  const activeKey = activeDay?.[0];
  const firstMatch = visible
    .flatMap(([, entries]) => entries)
    .find((item) => visibleIds.has(item.id));
  const focusHour = firstMatch ? hour(firstMatch.startsAt) : 8;
  useEffect(() => {
    if (scroller.current && activeKey && view) {
      // H47: position the calendar's own viewport at daytime without moving the page.
      scroller.current.scrollTop = Math.max(
        0,
        window.matchMedia("(max-width: 639px)").matches && view === "day"
          ? 0
          : (Math.min(
              Math.max(focusHour >= 6 ? Math.floor(focusHour) : 8, startHour),
              endHour - 2,
            ) -
              startHour) *
              HOUR_HEIGHT,
      );
    }
  }, [activeKey, view, focusHour]);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const halfHours = Array.from(
    { length: (endHour - startHour) * 2 },
    (_, index) => startHour * 2 + index,
  );
  useEffect(() => {
    const element = scroller.current;
    if (!element || !activeKey) return;
    const resize = () => {
      element.style.height = `${Math.max(320, window.innerHeight - element.getBoundingClientRect().top - 16)}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [activeKey]);
  if (!activeDay || items.length === 0)
    return (
      <div className="space-y-3">
        {renderToolbar?.(null)}
        <EmptyState icon={CalendarDotsIcon} title={emptyTitle ?? t("schedulePending")} />
      </div>
    );
  const dayHeader = (
    <div className="flex h-11 items-center justify-between gap-2 px-1">
      <IconButton
        label={t("previous")}
        variant="ghost"
        size="icon-sm"
        disabled={days.findIndex(([key]) => key === activeDay[0]) === 0}
        onClick={() => {
          const index = days.findIndex(([key]) => key === activeDay[0]);
          setSelectedDay(days[index - 1][0]);
        }}
      >
        <CaretLeftIcon aria-hidden="true" />
      </IconButton>
      <span className="min-w-0 text-center text-sm font-medium">
        {dateFormatter.format(new Date(activeDay[1][0].startsAt))}
      </span>
      <IconButton
        label={t("next")}
        variant="ghost"
        size="icon-sm"
        disabled={days.findIndex(([key]) => key === activeDay[0]) === days.length - 1}
        onClick={() => {
          const index = days.findIndex(([key]) => key === activeDay[0]);
          setSelectedDay(days[index + 1][0]);
        }}
      >
        <CaretRightIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={goToNow}>
        {t("today")}
      </Button>
      <TabBar width="content" aria-label={t("schedule")}>
        <TabsTrigger value="day">{t("calendarDay")}</TabsTrigger>
        <TabsTrigger value="week">{t("calendarWeek")}</TabsTrigger>
      </TabBar>
    </div>
  );
  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as "day" | "week")}
      className={cn("gap-0 space-y-3", className)}
    >
      {renderToolbar ? renderToolbar(controls) : controls}
      <TabsContent value={view}>
        <div
          ref={scroller}
          className="h-[calc(100dvh-19rem)] min-h-96 overflow-auto rounded-surface border bg-background"
        >
          {view === "day" && (
            <div className="divide-y divide-border/60 sm:hidden">
              <div className="sticky top-0 z-10 bg-background">{dayHeader}</div>
              {activeDay[1]
                .filter((item) => visibleIds.has(item.id))
                .map((item) => (
                  <div key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 p-3">
                    <time
                      dateTime={item.startsAt}
                      className="pt-2 text-xs text-muted-foreground tabular-nums"
                    >
                      {timeFormatter.format(new Date(item.startsAt))}
                    </time>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn(
                        "button-interaction min-w-0 rounded-sm border-l-[3px] px-3 py-2 text-left",
                        SCHEDULE_CATEGORY_STYLES[toActivityKind(item.type) ?? "activity"],
                      )}
                    >
                      <span className="block text-sm font-semibold">{item.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {t(activityKindLabelKey(toActivityKind(item.type) ?? "activity"))} ·{" "}
                        {timeFormatter.format(new Date(item.startsAt))}–
                        {timeFormatter.format(new Date(item.endsAt))}
                      </span>
                      {item.location && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPinIcon aria-hidden="true" className="size-3 shrink-0" />
                          {item.location}
                        </span>
                      )}
                    </button>
                  </div>
                ))}
            </div>
          )}
          <div
            className={cn("grid", view === "day" && "hidden sm:grid")}
            style={{
              gridTemplateColumns: `3.5rem repeat(${visible.length}, minmax(10rem, 1fr))`,
              minWidth: 56 + visible.length * 220,
            }}
          >
            <div className="sticky top-0 left-0 z-30 border-r border-b bg-background" />
            {visible.map(([key, entries]) => (
              <div
                key={`header-${key}`}
                className="sticky top-0 z-20 border-r border-b bg-background"
              >
                {view === "day" ? (
                  dayHeader
                ) : (
                  <div className="flex h-11 items-center justify-center gap-2 text-sm font-medium capitalize">
                    <span>{shortDate.format(new Date(entries[0].startsAt))}</span>
                    {key === today && (
                      <span
                        className="size-2 rounded-full bg-primary"
                        role="img"
                        aria-label={t("today")}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="sticky left-0 z-10 border-r bg-background" style={{ height }}>
              {hours.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-2 text-xs text-muted-foreground tabular-nums"
                  style={{ top: (tick - startHour) * HOUR_HEIGHT + 4 }}
                >
                  {String(tick).padStart(2, "0")}:00
                </span>
              ))}
              {showNow && (
                <time
                  role="img"
                  dateTime={new Date(now).toISOString()}
                  aria-label={`${t("currentTime")}: ${timeFormatter.format(new Date(now))}`}
                  className="pointer-events-none absolute right-1 z-30 -translate-y-1/2 rounded-full bg-destructive px-1 py-0.5 text-xs font-semibold leading-none text-destructive-foreground tabular-nums"
                  style={{ top: nowHour * HOUR_HEIGHT }}
                >
                  {timeFormatter.format(new Date(now))}
                </time>
              )}
            </div>
            {visible.map(([key, entries]) => {
              const toY = (instant: number) => {
                const iso = new Date(instant).toISOString();
                const wall = instantToWallClock(iso, timezone);
                return ((wall.slice(0, 10) > key ? 24 : hour(iso)) - startHour) * HOUR_HEIGHT;
              };
              const positioned = positionDayItems(
                entries.filter((item) => visibleIds.has(item.id)),
                toY,
              );
              return (
                <div key={key} className="relative border-r" style={{ height }}>
                  {halfHours.map((tick) => (
                    <div
                      key={tick}
                      className={cn(
                        "pointer-events-none absolute inset-x-0 border-t",
                        tick % 2 ? "border-border/30" : "border-border/70",
                      )}
                      style={{ top: ((tick - startHour * 2) * HOUR_HEIGHT) / 2 }}
                    />
                  ))}
                  {positioned.map(
                    ({ item, top, height: itemHeight, lane, laneCount, laneSpan }) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openItem(item)}
                        className={cn(
                          "button-interaction absolute flex flex-col items-start justify-start overflow-hidden rounded-sm border border-l-[3px] px-2 text-left",
                          itemHeight < 42 ? "py-0.5" : itemHeight < 60 ? "py-1" : "py-2",
                          SCHEDULE_CATEGORY_STYLES[toActivityKind(item.type) ?? "activity"],
                        )}
                        style={{
                          top,
                          height: itemHeight,
                          width: `calc(${(100 * laneSpan) / laneCount}% - ${LANE_GAP}px)`,
                          left: `calc(${(lane * 100) / laneCount}% + 2px)`,
                        }}
                      >
                        <span
                          className={cn(
                            "block max-w-full truncate font-semibold",
                            itemHeight < 60 ? "text-xs leading-4" : "text-sm",
                          )}
                        >
                          {item.title}
                        </span>
                        {itemHeight >= 42 && (
                          <span className="block max-w-full truncate text-xs opacity-80">
                            {t(activityKindLabelKey(toActivityKind(item.type) ?? "activity"))}
                            {` · ${timeFormatter.format(new Date(item.startsAt))}–${timeFormatter.format(new Date(item.endsAt))}`}
                          </span>
                        )}
                        {itemHeight >= 88 && item.location && (
                          <span className="mt-1 flex items-center gap-1 text-xs opacity-80">
                            <MapPinIcon aria-hidden="true" className="size-3 shrink-0" />
                            <span className="truncate">{item.location}</span>
                          </span>
                        )}
                      </button>
                    ),
                  )}
                  {showNow && (
                    <div
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute inset-x-0 z-10 border-t",
                        key === today ? "border-t-2 border-destructive" : "border-destructive/20",
                      )}
                      style={{ top: nowHour * HOUR_HEIGHT }}
                    >
                      {key === today && (
                        <span className="absolute -top-1.5 -left-1 size-2.5 rounded-full bg-destructive" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </TabsContent>
      <SidePanelEditor
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
        icon={CalendarDotsIcon}
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
              <p className="text-muted-foreground capitalize">
                {toActivityKind(selectedItem.type)
                  ? t(activityKindLabelKey(toActivityKind(selectedItem.type)!))
                  : selectedItem.type}
              </p>
            )}
            {selectedItem.description && (
              <p className="whitespace-pre-wrap text-pretty">{selectedItem.description}</p>
            )}
            {showResponsible && selectedItem.owners && selectedItem.owners.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">{t("ownersLabel")}</h3>
                <p className="text-muted-foreground whitespace-pre-wrap text-pretty">
                  {selectedItem.owners
                    .map(
                      (owner) =>
                        owner.freeTextName || [owner.name, owner.surname].filter(Boolean).join(" "),
                    )
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </div>
            )}
            {showResponsible && selectedItem.contactNote && (
              <div>
                <h3 className="text-sm font-medium">{t("contactNoteLabel")}</h3>
                <p className="text-muted-foreground whitespace-pre-wrap text-pretty">
                  {selectedItem.contactNote}
                </p>
              </div>
            )}
            {showResponsible && selectedItem.notes && (
              <div>
                <h3 className="text-sm font-medium">{t("internalNotesLabel")}</h3>
                <p className="whitespace-pre-wrap text-pretty">{selectedItem.notes}</p>
              </div>
            )}
          </div>
        )}
      </SidePanelEditor>
    </Tabs>
  );
}
