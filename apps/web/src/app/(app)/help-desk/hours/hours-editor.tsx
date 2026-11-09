"use client";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import {
  type AvailabilityInterval,
  type HelpdeskSchedule,
  MAX_AVAILABILITY_INTERVALS,
} from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useId, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { useEventTimeZone, useEventZoneHint } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";

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
          suggested={dialog.editing ?? schedule.suggestedInterval}
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
  const { t, language } = useLocale();
  const id = useId();
  const zone = useEventTimeZone();
  const zoneHint = useEventZoneHint(language);
  // Prefilled from the hacking window; every field stays editable.
  const [from, setFrom] = useState(() =>
    instantToWallClock(suggested?.startsAt ?? "", zone).slice(0, 16),
  );
  const [to, setTo] = useState(() =>
    instantToWallClock(suggested?.endsAt ?? "", zone).slice(0, 16),
  );
  const [submitted, setSubmitted] = useState(false);
  const startsAt = from ? wallClockToInstant(from, zone) : null;
  const endsAt = to ? wallClockToInstant(to, zone) : null;
  const ordered = !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const window = startsAt && endsAt && ordered ? { startsAt, endsAt } : null;
  const message =
    !startsAt || !endsAt
      ? submitted
        ? t("helpDeskHoursIncomplete")
        : null
      : !ordered
        ? t("helpDeskIntervalOrder")
        : window && others.some((other) => overlaps(window, other))
          ? t("helpDeskHoursOverlap")
          : null;
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={t(editing ? "helpDeskHoursEditTitle" : "helpDeskHoursAdd")}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (window && !message) onSave(window);
        }}
      >
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-from`}>{t("helpDeskFrom")}</Label>
            <DateTimeInput
              id={`${id}-from`}
              type="datetime-local"
              value={from}
              onChange={setFrom}
              aria-describedby={`${id}-status`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-to`}>{t("helpDeskTo")}</Label>
            <DateTimeInput
              id={`${id}-to`}
              type="datetime-local"
              value={to}
              onChange={setTo}
              aria-describedby={`${id}-status`}
            />
          </div>
          <p
            id={`${id}-status`}
            role={message ? "alert" : undefined}
            className={message ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {message ?? zoneHint}
          </p>
        </fieldset>
        {error ? (
          <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={pending} disabled={!!message && !!startsAt && !!endsAt}>
            {t(editing ? "saveChanges" : "helpDeskHoursAdd")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
