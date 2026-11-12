"use client";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { MAX_INTERVAL_MS } from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AvailabilityInterval } from "./model";
import { DAY_MINUTES, daysFrom, nextDayOf } from "./schedule";
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

type DragMode = "create" | "move" | "start" | "end";
interface Span {
  start: number;
  end: number;
}
interface Drag {
  mode: DragMode;
  interval?: AvailabilityInterval;
  /** Where the pointer went down and is now, as minutes from the first day's midnight. */
  anchor: number;
  at: number;
}

/** The stretch after a drag, in minutes from the first day's midnight, kept between `lo` and `hi`. */
export function dragged(
  mode: Exclude<DragMode, "create">,
  span: Span,
  delta: number,
  lo: number,
  hi: number,
): Span {
  if (mode === "move") {
    const moved = Math.min(Math.max(delta, lo - span.start), hi - span.end);
    return { start: span.start + moved, end: span.end + moved };
  }
  if (mode === "start") {
    return {
      start: Math.min(Math.max(span.start + delta, lo), span.end - SNAP_MINUTES),
      end: span.end,
    };
  }
  return {
    start: span.start,
    end: Math.min(Math.max(span.end + delta, span.start + SNAP_MINUTES), hi),
  };
}

/** A stretch split into the day lines it crosses. */
export function piecesOf(span: Span, rows: number) {
  const pieces: { row: number; start: number; end: number; fromPrev: boolean; toNext: boolean }[] =
    [];
  for (let row = Math.max(0, Math.floor(span.start / DAY_MINUTES)); row < rows; row++) {
    const lineStart = row * DAY_MINUTES;
    if (lineStart >= span.end) break;
    pieces.push({
      row,
      start: Math.max(span.start, lineStart) - lineStart,
      end: Math.min(span.end, lineStart + DAY_MINUTES) - lineStart,
      fromPrev: span.start < lineStart,
      toNext: span.end > lineStart + DAY_MINUTES,
    });
  }
  return pieces;
}

const dayNumber = (day: string) =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000;
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * Planned availability (H62) as one line per event day on one continuous
 * time axis: drag across a line to mark when you are around (30-minute steps),
 * and continue onto the next line to cross midnight. Drag a marked stretch to
 * move it or either edge to change its time; press it to edit or remove it. The
 * time before `notBefore` is hatched and cannot be used. A plain press on an
 * empty spot opens the add dialog for that day, and the Add availability button
 * remains the keyboard route. With `readOnly` it only shows the lines.
 */
export function AvailabilityTimeline({
  intervals,
  label,
  days = [],
  notBefore,
  fixedDays = false,
  maxDurationMs = MAX_INTERVAL_MS,
  disabled,
  readOnly = false,
  onCreate,
  onChange,
  onAddDay,
  onEdit,
}: {
  intervals: AvailabilityInterval[];
  label?: string;
  /** The event days to draw, each with a line even when empty. */
  days?: string[];
  /** Personal availability stays within the hacking days; opening hours may extend them. */
  fixedDays?: boolean;
  /** null allows opening windows of any duration. */
  maxDurationMs?: number | null;
  /** Instant before which nothing can be marked (the start of hacking). */
  notBefore?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  onCreate?: (interval: AvailabilityInterval) => void;
  /** A stretch moved or resized to this new range. */
  onChange?: (interval: AvailabilityInterval, next: AvailabilityInterval) => void;
  onAddDay?: (day: string) => void;
  onEdit?: (interval: AvailabilityInterval) => void;
}) {
  const { t } = useLocale();
  const zone = useEventTimeZone();
  const dayLabel = useDayLabel();
  const intervalLabel = useIntervalLabel();
  const interactive = !readOnly && !disabled;
  const tracks = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);

  const wall = (iso: string) => instantToWallClock(iso, zone);
  const spanDays = [
    ...days,
    ...intervals.flatMap((iv) => [
      wall(iv.startsAt).slice(0, 10),
      wall(new Date(Date.parse(iv.endsAt) - 1).toISOString()).slice(0, 10),
    ]),
  ].filter(Boolean);
  if (spanDays.length === 0) return null;
  const sorted = [...spanDays].sort((a, b) => a.localeCompare(b));
  const first =
    fixedDays && days.length ? [...days].sort((a, b) => a.localeCompare(b))[0] : sorted[0];
  // An interval ending exactly at midnight does not need the next day's line.
  const lastDay = sorted[sorted.length - 1];
  const rowDays =
    fixedDays && days.length
      ? [...new Set(days)].sort((a, b) => a.localeCompare(b))
      : daysFrom(first, lastDay);
  const total = rowDays.length * DAY_MINUTES;

  const minutesOf = (iso: string) => {
    const w = wall(iso);
    return (
      (dayNumber(w.slice(0, 10)) - dayNumber(first)) * DAY_MINUTES +
      Number(w.slice(11, 13)) * 60 +
      Number(w.slice(14, 16))
    );
  };
  const instantAt = (abs: number) => {
    const row = Math.floor(abs / DAY_MINUTES);
    let day = first;
    for (let i = 0; i < row; i++) day = nextDayOf(day);
    const minute = abs - row * DAY_MINUTES;
    return wallClockToInstant(`${day}T${clock(minute)}`, zone) ?? new Date(0).toISOString();
  };
  const spanOf = (iv: AvailabilityInterval): Span => ({
    start: minutesOf(iv.startsAt),
    end: minutesOf(iv.endsAt),
  });
  const lo = notBefore ? Math.max(0, minutesOf(notBefore)) : 0;
  const labelOf = (iv: AvailabilityInterval) => {
    const days =
      dayNumber(wall(iv.endsAt).slice(0, 10)) - dayNumber(wall(iv.startsAt).slice(0, 10));
    return `${intervalLabel({ ...iv, nextDay: false })}${days > 0 ? ` (+${days})` : ""}`;
  };

  /** The line and snapped minute under a pointer. */
  function locate(event: React.PointerEvent) {
    let row = 0;
    let best = Number.POSITIVE_INFINITY;
    tracks.current.forEach((track, index) => {
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const distance =
        event.clientY < rect.top
          ? rect.top - event.clientY
          : Math.max(0, event.clientY - rect.bottom);
      if (distance < best) {
        best = distance;
        row = index;
      }
    });
    const rect = (tracks.current[row] as HTMLDivElement).getBoundingClientRect();
    return { row, abs: row * DAY_MINUTES + minuteAt(event.clientX, rect.left, rect.width) };
  }

  function begin(event: React.PointerEvent, mode: DragMode, interval?: AvailabilityInterval) {
    const { abs } = locate(event);
    event.currentTarget.closest("fieldset")?.setPointerCapture?.(event.pointerId);
    setDrag({ mode, interval, anchor: abs, at: abs });
  }

  /** H62: cap the preview and saved range at 24 actual hours, including DST. */
  function preview(current: Drag): Span {
    const span =
      current.mode === "create"
        ? {
            start: Math.max(Math.min(current.anchor, current.at), lo),
            end: Math.max(current.anchor, current.at),
          }
        : dragged(
            current.mode,
            spanOf(current.interval as AvailabilityInterval),
            current.at - current.anchor,
            lo,
            total,
          );
    const start = Date.parse(instantAt(span.start));
    const end = Date.parse(instantAt(span.end));
    if (maxDurationMs === null || end - start <= maxDurationMs) return span;
    const keepEnd =
      current.mode === "start" || (current.mode === "create" && current.at < current.anchor);
    return keepEnd
      ? { start: minutesOf(new Date(end - maxDurationMs).toISOString()), end: span.end }
      : { start: span.start, end: minutesOf(new Date(start + maxDurationMs).toISOString()) };
  }

  function finish(event: React.PointerEvent) {
    if (!drag) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const done = drag;
    setDrag(null);
    if (done.mode === "create") {
      const { start, end } = preview(done);
      if (end - start >= SNAP_MINUTES) {
        onCreate?.({ startsAt: instantAt(start), endsAt: instantAt(end) });
      } else if (done.anchor === done.at) {
        onAddDay?.(rowDays[Math.min(rowDays.length - 1, Math.floor(done.anchor / DAY_MINUTES))]);
      }
      return;
    }
    const interval = done.interval as AvailabilityInterval;
    const span = spanOf(interval);
    const next = preview(done);
    if (next.start === span.start && next.end === span.end) {
      onEdit?.(interval);
      return;
    }
    onChange?.(interval, {
      startsAt: next.start === span.start ? interval.startsAt : instantAt(next.start),
      endsAt: next.end === span.end ? interval.endsAt : instantAt(next.end),
    });
  }

  // What is drawn: the stretches, the one being dragged where it would land, and the new one.
  const shown = intervals.map((iv) => {
    const span = spanOf(iv);
    if (drag && drag.interval === iv && drag.mode !== "create") {
      return { iv, span: preview(drag), live: true };
    }
    return { iv, span, live: false };
  });
  const creating = drag?.mode === "create" ? preview(drag) : null;
  const liveText = (span: Span) => {
    const days = Math.floor(span.end / DAY_MINUTES) - Math.floor(span.start / DAY_MINUTES);
    return `${clock(span.start % DAY_MINUTES)}–${clock(span.end % DAY_MINUTES)}${days > 0 ? ` (+${days})` : ""}`;
  };

  return (
    <TooltipProvider delayDuration={150}>
      <fieldset
        aria-label={label ?? t("helpDeskPlanTitle")}
        className={cn(
          "divide-y divide-border/60 border-y border-border/60 m-0 min-w-0 select-none p-0",
          disabled && !readOnly && "opacity-60",
        )}
        onPointerDown={(event) => {
          if (!interactive || event.button !== 0) return;
          if (
            (event.target as HTMLElement).closest("[data-track]") &&
            !(event.target as HTMLElement).closest("button")
          ) {
            begin(event, "create");
          }
        }}
        onPointerMove={(event) => {
          if (drag) setDrag({ ...drag, at: locate(event).abs });
        }}
        onPointerUp={finish}
        onPointerCancel={() => setDrag(null)}
      >
        {rowDays.map((day, row) => {
          const hatched = Math.min(DAY_MINUTES, Math.max(0, lo - row * DAY_MINUTES));
          return (
            <section
              key={day}
              aria-label={dayLabel(day)}
              className="grid min-w-0 items-center gap-x-6 gap-y-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="type-subheading tabular-nums">{dayLabel(day)}</h4>
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
                <div
                  ref={(node) => {
                    tracks.current[row] = node;
                  }}
                  data-track=""
                  className={cn(
                    "bg-muted relative h-10 w-full min-w-0 touch-pan-y overflow-hidden rounded-control",
                    interactive && "cursor-crosshair",
                  )}
                >
                  {[6, 12, 18].map((hour) => (
                    <span
                      key={hour}
                      aria-hidden="true"
                      className="bg-background pointer-events-none absolute inset-y-0 w-px"
                      style={{ left: `${(hour / 24) * 100}%` }}
                    />
                  ))}
                  {hatched > 0 ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-0 bg-muted-foreground/15 [background-image:repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_5px_6px)]"
                      style={{ width: `${(hatched / DAY_MINUTES) * 100}%` }}
                    />
                  ) : null}
                  {shown.flatMap(({ iv, span, live }) =>
                    piecesOf(span, rowDays.length)
                      .filter((piece) => piece.row === row)
                      .map((piece) => {
                        const key = `${iv.startsAt}-${row}`;
                        const style = {
                          left: `${(piece.start / DAY_MINUTES) * 100}%`,
                          width: `${((piece.end - piece.start) / DAY_MINUTES) * 100}%`,
                        };
                        const body = live ? liveText(span) : labelOf(iv);
                        const shape = cn(
                          !piece.fromPrev && "rounded-l-[4px]",
                          !piece.toNext && "rounded-r-[4px]",
                        );
                        const shared = cn(
                          "bg-chart-1 text-background absolute inset-y-1 overflow-hidden px-2 text-left text-[0.6875rem] leading-8 font-medium tabular-nums text-ellipsis whitespace-nowrap",
                          shape,
                        );
                        // The same tree while dragging (the tip stays closed), so the pressed element is never remounted.
                        const tip = (trigger: React.ReactNode) => (
                          <Tooltip key={key} open={live ? false : undefined}>
                            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>
                              {labelOf(iv)}
                            </TooltipContent>
                          </Tooltip>
                        );
                        if (!interactive) {
                          return tip(
                            <span className={shared} style={style}>
                              {body}
                            </span>,
                          );
                        }
                        return tip(
                          <button
                            type="button"
                            aria-label={t("helpDeskEditInterval", {
                              interval: `${dayLabel(day)} ${labelOf(iv)}`,
                            })}
                            className={cn(
                              shared,
                              "hover:bg-chart-1/85 focus-visible:ring-ring cursor-grab touch-none outline-none focus-visible:ring-2",
                              live && "cursor-grabbing",
                            )}
                            style={style}
                            onPointerDown={(event) => {
                              if (event.button !== 0) return;
                              event.stopPropagation();
                              const box = event.currentTarget.getBoundingClientRect();
                              const x = event.clientX - box.left;
                              const wide = box.width >= EDGE_PX * 3.5;
                              const mode: DragMode =
                                wide && !piece.fromPrev && x <= EDGE_PX
                                  ? "start"
                                  : wide && !piece.toNext && x >= box.width - EDGE_PX
                                    ? "end"
                                    : "move";
                              begin(event, mode, iv);
                            }}
                            onClick={(event) => {
                              // Keyboard activation; a pointer press is resolved when the pointer is released.
                              if (event.detail === 0) onEdit?.(iv);
                            }}
                          >
                            {!live && !piece.fromPrev ? (
                              <span
                                aria-hidden="true"
                                className="bg-background/60 absolute inset-y-1.5 left-1 w-0.5 cursor-ew-resize rounded-full"
                              />
                            ) : null}
                            {!live && !piece.toNext ? (
                              <span
                                aria-hidden="true"
                                className="bg-background/60 absolute inset-y-1.5 right-1 w-0.5 cursor-ew-resize rounded-full"
                              />
                            ) : null}
                            {body}
                          </button>,
                        );
                      }),
                  )}
                  {creating
                    ? piecesOf(creating, rowDays.length)
                        .filter((piece) => piece.row === row)
                        .map((piece, index) => (
                          <span
                            key="new"
                            aria-hidden="true"
                            className="bg-chart-1/50 pointer-events-none absolute inset-y-1 flex items-center justify-center rounded-[4px] text-xs font-medium tabular-nums whitespace-nowrap"
                            style={{
                              left: `${(piece.start / DAY_MINUTES) * 100}%`,
                              width: `${((piece.end - piece.start) / DAY_MINUTES) * 100}%`,
                            }}
                          >
                            {index === 0 ? liveText(creating) : null}
                          </span>
                        ))
                    : null}
                </div>
                {row === rowDays.length - 1 ? <HourAxis /> : null}
              </div>
            </section>
          );
        })}
      </fieldset>
    </TooltipProvider>
  );
}
