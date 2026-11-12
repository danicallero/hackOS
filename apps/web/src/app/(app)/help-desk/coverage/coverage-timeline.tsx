"use client";
import { useRef } from "react";
import { formatEventClock } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DAY_MINUTES } from "../schedule";
import { HourAxis, useDayLabel } from "../schedule-view";
import type { CoverageDay, PlacedSlot } from "./coverage-model";

const BAR_AREA = "h-16";

/**
 * H67: helpers scheduled per time slot, one 24-hour row per event day on a
 * shared vertical scale. Each bar is a button in one roving tab stop per day
 * (arrow keys move), so every count is reachable without hover; the selected
 * slot's details render beside the chart. Slots in the range with nobody
 * scheduled show a gap marker; hours outside the range stay empty.
 */
export function CoverageTimeline({
  days,
  stepMinutes,
  nowAt,
  selected,
  onSelect,
}: {
  days: CoverageDay[];
  stepMinutes: number;
  nowAt: string;
  selected: string | null;
  onSelect: (slot: PlacedSlot) => void;
}) {
  const { t, language } = useLocale();
  const dayLabel = useDayLabel();
  const max = Math.max(1, ...days.map((day) => day.peak));
  const nowMs = Date.parse(nowAt);
  return (
    <figure className="min-w-0 space-y-3">
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-chart-1 inline-block h-3 w-2 rounded-t-[2px]" />
          {t("helpDeskScheduledCount")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-warning inline-block h-0.5 w-3 rounded-full" />
          {t("helpDeskNoHelpersScheduled")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="bg-foreground inline-block h-3 w-px" />
          {t("now")}
        </span>
        <span className="tabular-nums">{t("helpDeskScaleMax", { count: max })}</span>
      </figcaption>
      <div className="divide-y divide-border/60">
        {days.map((day, index) => (
          <DayRow
            key={day.day}
            day={day}
            label={dayLabel(day.day)}
            max={max}
            stepMinutes={stepMinutes}
            nowMs={nowMs}
            selected={selected}
            onSelect={onSelect}
            axis={index === days.length - 1}
            describe={(slot) =>
              `${dayLabel(day.day)} ${formatEventClock(slot.startsAt, language)}–${formatEventClock(
                slot.endsAt,
                language,
              )}: ${t("helpDeskHelpersCount", { count: slot.scheduled })}`
            }
            summary={t("helpDeskDaySummary", { peak: day.peak, gaps: day.gaps })}
          />
        ))}
      </div>
    </figure>
  );
}

function DayRow({
  day,
  label,
  max,
  stepMinutes,
  nowMs,
  selected,
  onSelect,
  axis,
  describe,
  summary,
}: {
  day: CoverageDay;
  label: string;
  max: number;
  stepMinutes: number;
  nowMs: number;
  selected: string | null;
  onSelect: (slot: PlacedSlot) => void;
  axis: boolean;
  describe: (slot: PlacedSlot) => string;
  summary: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const width = (stepMinutes / DAY_MINUTES) * 100;
  // Counts sit inside the bars while a slot is wide enough to hold one.
  const labelled = stepMinutes >= 60;
  const focusIndex = Math.max(
    0,
    day.slots.findIndex((slot) => slot.startsAt === selected),
  );
  const nowSlot = day.slots.find(
    (slot) => Date.parse(slot.startsAt) <= nowMs && nowMs < Date.parse(slot.endsAt),
  );
  const nowLeft = nowSlot
    ? ((nowSlot.minute + (nowMs - Date.parse(nowSlot.startsAt)) / 60_000) / DAY_MINUTES) * 100
    : null;
  function move(event: React.KeyboardEvent, index: number) {
    const next =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? day.slots.length - 1
              : null;
    if (next === null || next < 0 || next >= day.slots.length) return;
    event.preventDefault();
    onSelect(day.slots[next]);
    group.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }
  return (
    <section
      aria-label={label}
      className="grid min-w-0 gap-x-4 gap-y-1 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <h3 className="type-subheading">{label}</h3>
        <p className="text-muted-foreground text-xs tabular-nums">{summary}</p>
      </div>
      <div className="min-w-0 space-y-1">
        <div ref={group} className={cn("relative border-b border-border", BAR_AREA)}>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 border-t border-dashed border-border/70"
          />
          {day.slots.map((slot, index) => {
            const isSelected = slot.startsAt === selected;
            return (
              <button
                key={slot.startsAt}
                type="button"
                tabIndex={index === focusIndex ? 0 : -1}
                aria-pressed={isSelected}
                aria-label={describe(slot)}
                title={describe(slot)}
                onClick={() => onSelect(slot)}
                onKeyDown={(event) => move(event, index)}
                className={cn(
                  "group absolute inset-y-0 flex items-end justify-center rounded-[2px] outline-none",
                  "hover:bg-muted/70 focus-visible:ring-ring focus-visible:ring-2",
                  isSelected && "bg-muted",
                )}
                style={{ left: `${(slot.minute / DAY_MINUTES) * 100}%`, width: `${width}%` }}
              >
                {slot.scheduled > 0 ? (
                  <span
                    aria-hidden="true"
                    className="bg-chart-1 flex w-[calc(100%-2px)] max-w-6 justify-center rounded-t-[4px] pt-0.5 text-[10px] leading-none font-medium text-white tabular-nums group-hover:opacity-80 dark:text-black"
                    style={{ height: `${(slot.scheduled / max) * 100}%` }}
                  >
                    {labelled && (slot.scheduled / max) * 64 >= 14 ? slot.scheduled : null}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="bg-warning h-0.5 w-[calc(100%-2px)] max-w-6 rounded-full"
                  />
                )}
              </button>
            );
          })}
          {nowLeft !== null ? (
            <span
              aria-hidden="true"
              className="bg-foreground pointer-events-none absolute -top-1 bottom-0 w-px"
              style={{ left: `${nowLeft}%` }}
            />
          ) : null}
        </div>
        {axis ? <HourAxis /> : null}
      </div>
    </section>
  );
}
