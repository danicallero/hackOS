"use client";
import {
  type AvailabilityInterval,
  type HelpdeskSchedule,
  MAX_AVAILABILITY_INTERVALS,
} from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { SwitchRow } from "@/components/profile/public-profile-form";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { AvailabilityTimeline } from "../availability-timeline";
import { IntervalDialog } from "../interval-dialog";
import { daysFrom, eventDay, intervalFrom, mergeInterval } from "../schedule";

const overlaps = (a: AvailabilityInterval, b: AvailabilityInterval) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/**
 * H64: the windows in which new help requests are accepted. No windows means
 * always open. Each change saves the complete replacement immediately, like
 * planned availability (H62), so there is no draft to lose.
 */
export function HoursEditor({
  schedule,
  onSaved,
}: {
  schedule: HelpdeskSchedule;
  onSaved: (schedule: HelpdeskSchedule) => void;
}) {
  const { t, language } = useLocale();
  const [dialog, setDialog] = useState<{
    editing: AvailabilityInterval | null;
    suggested?: AvailabilityInterval | null;
  } | null>(null);
  const zone = useEventTimeZone();
  const days = schedule.suggestedInterval
    ? daysFrom(
        eventDay(schedule.suggestedInterval.startsAt, zone),
        eventDay(schedule.suggestedInterval.endsAt, zone),
      )
    : [];
  const [optimistic, setOptimistic] = useState<AvailabilityInterval[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function replace(
    windows: AvailabilityInterval[],
    eventAccessOnly: boolean = schedule.eventAccessOnly,
  ) {
    setPending(true);
    setError(null);
    setOptimistic(windows);
    try {
      onSaved(
        await api.put<HelpdeskSchedule>("/api/helpdesk/schedule", { windows, eventAccessOnly }),
      );
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(false);
      setOptimistic(null);
    }
  }

  const status = schedule.open ? t("helpDeskHoursOpenNow") : t("helpDeskHoursClosedNow");
  const change = schedule.nextChangeAt
    ? t(schedule.open ? "helpDeskHoursCloses" : "helpDeskHoursOpens", {
        date: formatEventDate(schedule.nextChangeAt, language, "dateTime"),
      })
    : null;
  return (
    <div className="space-y-3">
      <SwitchRow
        checked={schedule.eventAccessOnly}
        disabled={pending}
        onChange={(only) => void replace(schedule.windows, only)}
        label={t("helpDeskEventAccessOnly")}
      />
      <div className="flex min-h-(--control-height-compact) items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">{status}</span>
          {schedule.configured && change ? (
            <span className="text-muted-foreground"> · {change}</span>
          ) : null}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || schedule.windows.length >= MAX_AVAILABILITY_INTERVALS}
          onClick={() => {
            setError(null);
            setDialog({ editing: null });
          }}
        >
          <PlusIcon aria-hidden="true" />
          {t("helpDeskHoursAdd")}
        </Button>
      </div>
      <AvailabilityTimeline
        label={t("helpDeskHours")}
        intervals={optimistic ?? schedule.windows}
        days={days}
        maxDurationMs={null}
        disabled={pending}
        onCreate={(window) => {
          if (!pending) void replace(mergeInterval(schedule.windows, window));
        }}
        onChange={(window, next) => {
          if (!pending)
            void replace(
              mergeInterval(
                schedule.windows.filter((item) => item.startsAt !== window.startsAt),
                next,
              ),
            );
        }}
        onAddDay={(day) => {
          setError(null);
          setDialog({ editing: null, suggested: intervalFrom(day, "09:00", "17:00", zone) });
        }}
        onEdit={(window) => {
          setError(null);
          setDialog({ editing: window });
        }}
      />
      {!schedule.windows.length ? (
        <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskHoursEmpty")}</p>
      ) : null}
      {error && !dialog ? (
        <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
      ) : null}
      {dialog ? (
        <WindowDialog
          editing={dialog.editing}
          others={schedule.windows.filter((item) => item.startsAt !== dialog.editing?.startsAt)}
          suggested={dialog.editing ?? dialog.suggested ?? nextFreeWindow(schedule)}
          onRemove={
            dialog.editing
              ? async () => {
                  if (
                    await replace(
                      schedule.windows.filter((item) => item.startsAt !== dialog.editing?.startsAt),
                    )
                  )
                    setDialog(null);
                }
              : undefined
          }
          pending={pending}
          error={error}
          onClose={() => setDialog(null)}
          onSave={async (window) => {
            const kept = schedule.windows.filter(
              (item) => item.startsAt !== dialog.editing?.startsAt,
            );
            const next = [...kept, window].sort(
              (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
            );
            if (await replace(next)) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function WindowDialog({
  editing,
  others,
  suggested,
  pending,
  error,
  onClose,
  onSave,
  onRemove,
}: {
  editing: AvailabilityInterval | null;
  others: AvailabilityInterval[];
  suggested: AvailabilityInterval | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (window: AvailabilityInterval) => void;
  onRemove?: () => void;
}) {
  const { t } = useLocale();
  return (
    <IntervalDialog
      title={t(editing ? "helpDeskHoursEditTitle" : "helpDeskHoursAdd")}
      submitLabel={t(editing ? "saveChanges" : "helpDeskHoursAdd")}
      initial={suggested}
      incompleteMessage={t("helpDeskHoursIncomplete")}
      validate={(window) =>
        others.some((other) => overlaps(window, other)) ? t("helpDeskHoursOverlap") : null
      }
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={onSave}
      onRemove={onRemove}
    />
  );
}

/**
 * The prefill of a new window: the hacking window when nothing is set, else the
 * stretch after the last window (until the hacking window's end when that is
 * later, else eight hours), so it never opens already overlapping.
 */
function nextFreeWindow(schedule: {
  windows: AvailabilityInterval[];
  suggestedInterval: AvailabilityInterval | null;
}): AvailabilityInterval | null {
  if (schedule.windows.length === 0) return schedule.suggestedInterval;
  const lastEnd = Math.max(...schedule.windows.map((window) => Date.parse(window.endsAt)));
  const hackingEnd = schedule.suggestedInterval
    ? Date.parse(schedule.suggestedInterval.endsAt)
    : Number.NEGATIVE_INFINITY;
  const end = hackingEnd > lastEnd ? hackingEnd : lastEnd + 8 * 3_600_000;
  return { startsAt: new Date(lastEnd).toISOString(), endsAt: new Date(end).toISOString() };
}
