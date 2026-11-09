"use client";
import {
  type AvailabilityInterval,
  type HelpdeskSchedule,
  MAX_AVAILABILITY_INTERVALS,
} from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { IntervalDialog } from "../interval-dialog";

const overlaps = (a: AvailabilityInterval, b: AvailabilityInterval) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

/**
 * H64: the windows in which new help requests are accepted. No windows means
 * always open. Each change saves the complete replacement immediately, like
 * stated availability (H62), so there is no draft to lose.
 */
export function HoursEditor({
  schedule,
  onSaved,
}: {
  schedule: HelpdeskSchedule;
  onSaved: (schedule: HelpdeskSchedule) => void;
}) {
  const { t, language } = useLocale();
  const [dialog, setDialog] = useState<{ editing: AvailabilityInterval | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const label = (window: AvailabilityInterval) =>
    `${formatEventDate(window.startsAt, language, "dateTime")} – ${formatEventDate(window.endsAt, language, "dateTime")}`;

  async function replace(windows: AvailabilityInterval[]) {
    setPending(true);
    setError(null);
    try {
      onSaved(await api.put<HelpdeskSchedule>("/api/helpdesk/schedule", { windows }));
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(false);
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
      {schedule.windows.length ? (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {schedule.windows.map((window) => (
            <li
              key={window.startsAt}
              className="flex min-h-(--control-height-compact) items-center justify-between gap-3 py-1.5"
            >
              <span className="text-sm tabular-nums">{label(window)}</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={t("helpDeskHoursEdit", { window: label(window) })}
                  onClick={() => {
                    setError(null);
                    setDialog({ editing: window });
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={t("helpDeskHoursRemove", { window: label(window) })}
                  onClick={() =>
                    void replace(
                      schedule.windows.filter((item) => item.startsAt !== window.startsAt),
                    )
                  }
                >
                  {t("remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskHoursEmpty")}</p>
      )}
      {error && !dialog ? (
        <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
      ) : null}
      {dialog ? (
        <WindowDialog
          editing={dialog.editing}
          others={schedule.windows.filter((item) => item.startsAt !== dialog.editing?.startsAt)}
          suggested={dialog.editing ?? nextFreeWindow(schedule)}
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
}: {
  editing: AvailabilityInterval | null;
  others: AvailabilityInterval[];
  suggested: AvailabilityInterval | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (window: AvailabilityInterval) => void;
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
