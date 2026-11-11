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
/** Width of the grabbable edge of a marked stretch; narrower stretches only move. */
const EDGE_PX = 8;

/** The snapped minute of the day under a pointer, clamped to the track. */
export function minuteAt(clientX: number, left: number, width: number): number {
  if (width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return Math.round((ratio * DAY_MINUTES) / SNAP_MINUTES) * SNAP_MINUTES;
}

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

type DragMode = "create" | "move" | "start" | "end";
interface Drag {
  mode: DragMode;
  interval?: DayInterval;
  anchor: number;
  at: number;
}

/** How far (in minutes) a drag moved the stretch's start and end, kept inside the day. */
export function adjustment(
  mode: Exclude<DragMode, "create">,
  interval: Pick<DayInterval, "start" | "end">,
  delta: number,
): { startDelta: number; endDelta: number } {
  const length = interval.end - interval.start;
  if (mode === "move") {
    const moved = Math.min(Math.max(delta, -interval.start), DAY_MINUTES - interval.end);
    return { startDelta: moved, endDelta: moved };
  }
  if (mode === "start") {
    return {
      startDelta: Math.min(Math.max(delta, -interval.start), length - SNAP_MINUTES),
      endDelta: 0,
    };
  }
  return {
    startDelta: 0,
    endDelta: Math.min(Math.max(delta, SNAP_MINUTES - length), DAY_MINUTES - interval.end),
  };
}

/**
 * Stated availability (H62) as one line per event day: drag across a line to
 * mark when you are around (30-minute steps), drag a marked stretch to move it
 * or either of its edges to change its time, or press it to edit or remove it.
 * A plain press on an empty spot opens the add dialog for that day, and the Add
 * availability button remains the keyboard route. Without handlers it is a
 * read-only view of the same lines.
 */
export function AvailabilityTimeline({
  intervals,
  days = [],
  disabled,
  readOnly = false,
  onDrag,
  onAddDay,
  onEdit,
  onAdjust,
}: {
  intervals: AvailabilityInterval[];
  /** The event days to draw, each with a line even when empty. */
  days?: string[];
  disabled?: boolean;
  readOnly?: boolean;
  /** A finished drag on `day`, in event-zone minutes after midnight (end may be 1440). */
  onDrag?: (day: string, startMinute: number, endMinute: number) => void;
  onAddDay?: (day: string) => void;
  onEdit?: (interval: AvailabilityInterval) => void;
  /** A stretch moved or resized: how many minutes its start and end shifted. */
  onAdjust?: (interval: AvailabilityInterval, startDelta: number, endDelta: number) => void;
}) {
  const { t } = useLocale();
  const zone = useEventTimeZone();
  const dayLabel = useDayLabel();
  const intervalLabel = useIntervalLabel();
  const byDay = new Map(scheduleDays(intervals, zone).map((entry) => [entry.day, entry.intervals]));
  const allDays = [...new Set([...days, ...byDay.keys()])].sort((a, b) => a.localeCompare(b));
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
            {!readOnly && onAddDay ? (
              <IconButton
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                label={t("helpDeskAddIntervalOn", { day: dayLabel(day) })}
                onClick={() => onAddDay(day)}
              >
                <PlusIcon aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
          <div className="min-w-0 space-y-1">
            <Track
              intervals={byDay.get(day) ?? []}
              disabled={disabled}
              readOnly={readOnly}
              label={readOnly ? dayLabel(day) : t("helpDeskAddIntervalOn", { day: dayLabel(day) })}
              text={intervalLabel}
              describe={(interval) =>
                t("helpDeskEditInterval", {
                  interval: `${dayLabel(day)} ${intervalLabel(interval)}`,
                })
              }
              onCreate={(start, end) => onDrag?.(day, start, end)}
              onClick={() => onAddDay?.(day)}
              onEdit={(interval) => onEdit?.(interval)}
              onAdjust={(interval, startDelta, endDelta) =>
                onAdjust?.(interval, startDelta, endDelta)
              }
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
  readOnly,
  label,
  describe,
  text,
  onCreate,
  onClick,
  onEdit,
  onAdjust,
}: {
  intervals: DayInterval[];
  disabled?: boolean;
  readOnly: boolean;
  label: string;
  describe: (interval: DayInterval) => string;
  text: (interval: DayInterval) => string;
  onCreate: (start: number, end: number) => void;
  onClick: () => void;
  onEdit: (interval: AvailabilityInterval) => void;
  onAdjust: (interval: AvailabilityInterval, startDelta: number, endDelta: number) => void;
}) {
  const track = useRef<HTMLFieldSetElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const interactive = !readOnly && !disabled;
  const minute = (event: React.PointerEvent) => {
    const rect = (track.current as HTMLFieldSetElement).getBoundingClientRect();
    return minuteAt(event.clientX, rect.left, rect.width);
  };

  function begin(event: React.PointerEvent, interval?: DayInterval) {
    const at = minute(event);
    let mode: DragMode = "create";
    if (interval) {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const x = event.clientX - box.left;
      mode =
        box.width < EDGE_PX * 3.5
          ? "move"
          : x <= EDGE_PX
            ? "start"
            : x >= box.width - EDGE_PX
              ? "end"
              : "move";
    }
    track.current?.setPointerCapture?.(event.pointerId);
    setDrag({ mode, interval, anchor: at, at });
  }

  function finish(event: React.PointerEvent) {
    if (!drag) return;
    track.current?.releasePointerCapture?.(event.pointerId);
    const finished = drag;
    setDrag(null);
    if (finished.mode === "create") {
      const [from, to] = [
        Math.min(finished.anchor, finished.at),
        Math.max(finished.anchor, finished.at),
      ];
      if (to - from >= SNAP_MINUTES) onCreate(from, to);
      else onClick();
      return;
    }
    const interval = finished.interval as DayInterval;
    const { startDelta, endDelta } = adjustment(
      finished.mode,
      interval,
      finished.at - finished.anchor,
    );
    if (startDelta === 0 && endDelta === 0) onEdit(interval);
    else onAdjust(interval, startDelta, endDelta);
  }

  // The stretch being moved or resized is drawn where it would land.
  const preview = (interval: DayInterval) => {
    if (!drag || drag.interval !== interval || drag.mode === "create") return interval;
    const { startDelta, endDelta } = adjustment(drag.mode, interval, drag.at - drag.anchor);
    return { ...interval, start: interval.start + startDelta, end: interval.end + endDelta };
  };
  const creating =
    drag?.mode === "create"
      ? [Math.min(drag.anchor, drag.at), Math.max(drag.anchor, drag.at)]
      : null;
  return (
    <fieldset
      ref={track}
      aria-label={label}
      className={cn(
        "bg-muted relative m-0 h-10 w-full min-w-0 touch-pan-y overflow-hidden rounded-control border-0 p-0 select-none",
        interactive && "cursor-crosshair",
        disabled && !readOnly && "opacity-60",
      )}
      onPointerDown={(event) => {
        if (interactive && event.button === 0 && event.target === event.currentTarget) begin(event);
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, at: minute(event) });
      }}
      onPointerUp={finish}
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
      {intervals.map((interval) => {
        const shown = preview(interval);
        const movable = interactive && !interval.nextDay;
        const dragging = drag?.interval === interval;
        const style = {
          left: `${(shown.start / DAY_MINUTES) * 100}%`,
          width: `${((shown.end - shown.start) / DAY_MINUTES) * 100}%`,
        };
        const body = dragging ? `${clock(shown.start)}–${clock(shown.end)}` : text(interval);
        const shared =
          "bg-chart-1 text-background absolute inset-y-1 overflow-hidden rounded-[4px] px-2 text-left text-[0.6875rem] leading-8 font-medium tabular-nums whitespace-nowrap";
        if (!interactive) {
          return (
            <span key={interval.startsAt} className={shared} style={style}>
              {body}
            </span>
          );
        }
        return (
          <button
            key={interval.startsAt}
            type="button"
            aria-label={describe(interval)}
            className={cn(
              shared,
              "hover:bg-chart-1/85 focus-visible:ring-ring outline-none focus-visible:ring-2",
              movable ? "cursor-grab touch-none" : "cursor-pointer",
              dragging && "cursor-grabbing",
            )}
            style={style}
            onPointerDown={(event) => {
              if (!movable || event.button !== 0) return;
              event.stopPropagation();
              begin(event, interval);
            }}
            onClick={(event) => {
              // Keyboard activation; a pointer press is resolved when the pointer is released.
              if (event.detail === 0 || !movable) onEdit(interval);
            }}
          >
            {movable && !dragging ? (
              <>
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 left-1 w-0.5 cursor-ew-resize rounded-full bg-background/60"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 right-1 w-0.5 cursor-ew-resize rounded-full bg-background/60"
                />
              </>
            ) : null}
            {body}
          </button>
        );
      })}
      {creating && creating[1] > creating[0] ? (
        <span
          aria-hidden="true"
          className="bg-chart-1/50 pointer-events-none absolute inset-y-1 flex items-center justify-center rounded-[4px] text-xs font-medium tabular-nums"
          style={{
            left: `${(creating[0] / DAY_MINUTES) * 100}%`,
            width: `${((creating[1] - creating[0]) / DAY_MINUTES) * 100}%`,
          }}
        >
          {clock(creating[0])}–{clock(creating[1])}
        </span>
      ) : null}
    </fieldset>
  );
}
