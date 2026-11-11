"use client";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AvailabilityInterval } from "./model";
import { DAY_MINUTES, type DayInterval, scheduleDays } from "./schedule";
import { HourAxis, useDayLabel, useIntervalLabel } from "./schedule-view";

/** Dragging snaps to this many minutes. */
export const SNAP_MINUTES = 30;

/** The snapped minute of the day under a pointer, clamped to the track. */
export function minuteAt(clientX: number, left: number, width: number): number {
  if (width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round((ratio * DAY_MINUTES) / SNAP_MINUTES) * SNAP_MINUTES;
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * Stated availability (H62) as one line per event day: drag across a track to
 * mark when you are around (30-minute steps), or press a marked stretch to edit
 * or remove it. A plain press on an empty stretch opens the add dialog for that
 * day, and the Add availability button remains the keyboard route.
 */
export function AvailabilityTimeline({
  intervals,
  days,
  disabled,
  onDrag,
  onAddDay,
  onEdit,
}: {
  intervals: AvailabilityInterval[];
  /** The event days to draw, each with a line even when empty. */
  days: string[];
  disabled?: boolean;
  /** A finished drag on `day`, in event-zone minutes after midnight (end may be 1440). */
  onDrag: (day: string, startMinute: number, endMinute: number) => void;
  onAddDay: (day: string) => void;
  onEdit: (interval: AvailabilityInterval) => void;
}) {
  const { t } = useLocale();
  const zone = useEventTimeZone();
  const dayLabel = useDayLabel();
  const intervalLabel = useIntervalLabel();
  const byDay = new Map(scheduleDays(intervals, zone).map((entry) => [entry.day, entry.intervals]));
  const allDays = [...new Set([...days, ...byDay.keys()])].sort();
  if (allDays.length === 0) return null;
  return (
    <div className="divide-y divide-border/60 border-y border-border/60">
      {allDays.map((day, index) => (
        <section
          key={day}
          aria-label={dayLabel(day)}
          className="grid min-w-0 items-center gap-x-6 gap-y-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium tabular-nums">{dayLabel(day)}</h4>
            <IconButton
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              label={t("helpDeskAddIntervalOn", { day: dayLabel(day) })}
              onClick={() => onAddDay(day)}
            >
              <PlusIcon aria-hidden="true" />
            </IconButton>
          </div>
          <div className="min-w-0 space-y-1">
            <Track
              intervals={byDay.get(day) ?? []}
              disabled={disabled}
              label={t("helpDeskAddIntervalOn", { day: dayLabel(day) })}
              text={intervalLabel}
              describe={(interval) =>
                t("helpDeskEditInterval", {
                  interval: `${dayLabel(day)} ${intervalLabel(interval)}`,
                })
              }
              onDrag={(start, end) => onDrag(day, start, end)}
              onClick={() => onAddDay(day)}
              onEdit={onEdit}
            />
            {index === allDays.length - 1 ? <HourAxis /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Track({
  intervals,
  disabled,
  label,
  describe,
  text,
  onDrag,
  onClick,
  onEdit,
}: {
  intervals: DayInterval[];
  disabled?: boolean;
  label: string;
  describe: (interval: DayInterval) => string;
  text: (interval: DayInterval) => string;
  onDrag: (start: number, end: number) => void;
  onClick: () => void;
  onEdit: (interval: AvailabilityInterval) => void;
}) {
  const track = useRef<HTMLFieldSetElement>(null);
  const [drag, setDrag] = useState<{ anchor: number; at: number } | null>(null);
  const minute = (event: React.PointerEvent) => {
    const rect = (track.current as HTMLFieldSetElement).getBoundingClientRect();
    return minuteAt(event.clientX, rect.left, rect.width);
  };
  const start = drag ? Math.min(drag.anchor, drag.at) : 0;
  const end = drag ? Math.max(drag.anchor, drag.at) : 0;
  return (
    <fieldset
      ref={track}
      aria-label={label}
      className={cn(
        "bg-muted relative m-0 h-10 w-full min-w-0 border-0 p-0 touch-pan-y overflow-hidden rounded-control select-none",
        disabled ? "opacity-60" : "cursor-crosshair",
      )}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || event.target !== event.currentTarget) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = minute(event);
        setDrag({ anchor: at, at });
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, at: minute(event) });
      }}
      onPointerUp={(event) => {
        if (!drag) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const [from, to] = [Math.min(drag.anchor, drag.at), Math.max(drag.anchor, drag.at)];
        setDrag(null);
        if (to - from >= SNAP_MINUTES) onDrag(from, to);
        else onClick();
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {[6, 12, 18].map((hour) => (
        <span
          key={hour}
          aria-hidden="true"
          className="bg-background pointer-events-none absolute inset-y-0 w-px"
          style={{ left: `${(hour / 24) * 100}%` }}
        />
      ))}
      {intervals.map((interval) => (
        <button
          key={interval.startsAt}
          type="button"
          disabled={disabled}
          aria-label={describe(interval)}
          className="bg-chart-1 hover:bg-chart-1/85 focus-visible:ring-ring text-background absolute inset-y-1 cursor-pointer overflow-hidden rounded-[4px] px-1.5 text-left text-[0.6875rem] font-medium tabular-nums whitespace-nowrap outline-none focus-visible:ring-2"
          style={{
            left: `${(interval.start / DAY_MINUTES) * 100}%`,
            width: `${((interval.end - interval.start) / DAY_MINUTES) * 100}%`,
          }}
          onClick={() => onEdit(interval)}
        >
          {text(interval)}
        </button>
      ))}
      {drag && end > start ? (
        <span
          aria-hidden="true"
          className="bg-chart-1/50 pointer-events-none absolute inset-y-1 flex items-center justify-center rounded-[4px] text-xs font-medium tabular-nums"
          style={{
            left: `${(start / DAY_MINUTES) * 100}%`,
            width: `${((end - start) / DAY_MINUTES) * 100}%`,
          }}
        >
          {clock(start)}–{clock(end)}
        </span>
      ) : null}
    </fieldset>
  );
}
