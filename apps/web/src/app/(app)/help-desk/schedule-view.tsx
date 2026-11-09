"use client";
import { Button } from "@/components/ui/button";
import { formatEventClock, formatEventDate } from "@/lib/datetime";
import { useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import type { AvailabilityInterval } from "./model";
import { DAY_MINUTES, type DayInterval, dayInstant, scheduleDays } from "./schedule";

const TICKS = [0, 6, 12, 18, 24];

/** "Sat, 27 Feb" for an event day key. */
export function useDayLabel() {
  const { language } = useLocale();
  const zone = useEventTimeZone();
  return (day: string) => formatEventDate(dayInstant(day, zone), language, "weekdayDayMonthText");
}

/** "10:00–13:00", with "+1" when it ends the next day. */
export function useIntervalLabel() {
  const { language } = useLocale();
  return (interval: Pick<DayInterval, "startsAt" | "endsAt" | "nextDay">) =>
    `${formatEventClock(interval.startsAt, language)}–${formatEventClock(interval.endsAt, language)}${
      interval.nextDay ? " (+1)" : ""
    }`;
}

/**
 * Stated availability (H62) as readable rows per event day, each day with a
 * 24-hour track that previews when the person is around. With `onRemove`
 * every interval gets its own labelled Remove action.
 */
export function ScheduleDays({
  intervals,
  onRemove,
  onEdit,
  onAddDay,
  plannedDays,
  disabled,
}: {
  intervals: AvailabilityInterval[];
  onRemove?: (interval: AvailabilityInterval) => void;
  onEdit?: (interval: AvailabilityInterval) => void;
  /** Event days (`yyyy-MM-dd`) shown even without ranges, each with an Add action. */
  plannedDays?: string[];
  onAddDay?: (day: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const zone = useEventTimeZone();
  const dayLabel = useDayLabel();
  const intervalLabel = useIntervalLabel();
  const withRanges = scheduleDays(intervals, zone);
  const days = [
    ...withRanges,
    ...(plannedDays ?? [])
      .filter((day) => !withRanges.some((entry) => entry.day === day))
      .map((day) => ({ day, intervals: [] as DayInterval[] })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  if (!days.length)
    return <p className="text-muted-foreground text-sm">{t("helpDeskNoSchedule")}</p>;
  return (
    <div className="divide-y divide-border/60 border-y border-border/60">
      {days.map(({ day, intervals: list }, index) => (
        <section
          key={day}
          aria-label={dayLabel(day)}
          className="grid min-w-0 gap-x-6 gap-y-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <h4 className="text-sm font-medium tabular-nums">{dayLabel(day)}</h4>
          <div className="min-w-0 space-y-2">
            <ul className="space-y-1">
              {list.map((interval) => (
                <li
                  key={interval.startsAt}
                  className="flex min-h-(--control-height-compact) items-center justify-between gap-3"
                >
                  <span className="text-sm tabular-nums">{intervalLabel(interval)}</span>
                  <div className="flex gap-2">
                    {onEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={t("helpDeskEditInterval", {
                          interval: `${dayLabel(day)} ${intervalLabel(interval)}`,
                        })}
                        onClick={() => onEdit(interval)}
                      >
                        {t("edit")}
                      </Button>
                    ) : null}
                    {onRemove ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={t("helpDeskRemoveInterval", {
                          interval: `${dayLabel(day)} ${intervalLabel(interval)}`,
                        })}
                        onClick={() => onRemove(interval)}
                      >
                        {t("remove")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {onAddDay ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t("helpDeskAddIntervalOn", { day: dayLabel(day) })}
                onClick={() => onAddDay(day)}
              >
                {t("helpDeskAddInterval")}
              </Button>
            ) : null}
            <DayTrack intervals={list} labels={index === days.length - 1} />
          </div>
        </section>
      ))}
    </div>
  );
}

/** A 24-hour track with the day's intervals filled in; decorative beside the rows. */
function DayTrack({ intervals, labels }: { intervals: DayInterval[]; labels: boolean }) {
  return (
    <div aria-hidden="true" className="space-y-1">
      <div className="bg-muted relative h-2 overflow-hidden rounded-full">
        {TICKS.slice(1, -1).map((hour) => (
          <span
            key={hour}
            className="bg-background absolute inset-y-0 w-px"
            style={{ left: `${(hour / 24) * 100}%` }}
          />
        ))}
        {intervals.map((interval) => (
          <span
            key={interval.startsAt}
            className="bg-chart-1 absolute inset-y-0 rounded-full"
            style={{
              left: `${(interval.start / DAY_MINUTES) * 100}%`,
              width: `${((interval.end - interval.start) / DAY_MINUTES) * 100}%`,
            }}
          />
        ))}
      </div>
      {labels ? <HourAxis /> : null}
    </div>
  );
}

/** 00 · 06 · 12 · 18 · 24 under a day-wide track. */
export function HourAxis() {
  return (
    <div className="text-muted-foreground relative h-4 text-[0.6875rem] tabular-nums">
      {TICKS.map((hour) => (
        <span
          key={hour}
          className="absolute top-0"
          style={{
            left: `${(hour / 24) * 100}%`,
            transform:
              hour === 0 ? undefined : hour === 24 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {String(hour).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}
