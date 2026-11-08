"use client";
import { MAX_AVAILABILITY_INTERVALS } from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useId, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatDurationMinutes } from "@/lib/datetime";
import { useEventTimeZone, useEventZoneHint } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import type { AvailabilityInterval, MyHelperProfile } from "./model";
import { durationMinutes, eventDay, intervalFrom, intervalProblem } from "./schedule";
import { ScheduleDays, useDayLabel } from "./schedule-view";

/**
 * Stated availability (H62): the saved intervals as rows per event day, an
 * Add dialog (day, from, to) and a Remove action per row. Each change saves
 * the complete replacement immediately, so there is no draft to lose.
 */
export function AvailabilityEditor({
  profile,
  onSaved,
}: {
  profile: MyHelperProfile;
  onSaved: (profile: MyHelperProfile) => void;
}) {
  const { t } = useLocale();
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function replace(intervals: AvailabilityInterval[]) {
    setPending(true);
    setError(null);
    try {
      onSaved(await api.put<MyHelperProfile>("/api/me/helper-profile/availability", { intervals }));
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-(--control-height-compact) items-center justify-between gap-3">
        <h3 className="type-label">{t("helpDeskSchedule")}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || profile.availability.length >= MAX_AVAILABILITY_INTERVALS}
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {t("helpDeskAddInterval")}
        </Button>
      </div>
      <ScheduleDays
        intervals={profile.availability}
        disabled={pending}
        onRemove={(removed) =>
          void replace(profile.availability.filter((item) => item.startsAt !== removed.startsAt))
        }
      />
      {error && !adding ? (
        <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
      ) : null}
      {adding ? (
        <AddIntervalDialog
          existing={profile.availability}
          pending={pending}
          error={error}
          onClose={() => setAdding(false)}
          onAdd={async (interval) => {
            if (await replace([...profile.availability, interval])) setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AddIntervalDialog({
  existing,
  pending,
  error,
  onClose,
  onAdd,
}: {
  existing: AvailabilityInterval[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onAdd: (interval: AvailabilityInterval) => void;
}) {
  const { t, language } = useLocale();
  const id = useId();
  const zone = useEventTimeZone();
  const zoneHint = useEventZoneHint(language);
  const dayLabel = useDayLabel();
  const last = existing.at(-1);
  const [day, setDay] = useState(() => eventDay(last?.startsAt ?? new Date().toISOString(), zone));
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("13:00");
  const [submitted, setSubmitted] = useState(false);
  const interval = intervalFrom(day, from, to, zone);
  const problem = interval ? intervalProblem(interval, existing) : null;
  const message = !interval
    ? submitted
      ? t("helpDeskIntervalIncomplete")
      : null
    : problem === "overlap"
      ? t("helpDeskIntervalOverlap")
      : problem === "tooLong"
        ? t("helpDeskIntervalTooLong")
        : null;
  const summary =
    interval && !problem
      ? [
          dayLabel(day),
          formatDurationMinutes(durationMinutes(interval), t),
          to <= from ? t("helpDeskEndsNextDay") : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("helpDeskAddInterval")}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (interval && !problem) onAdd(interval);
        }}
      >
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-day`}>{t("helpDeskDay")}</Label>
            <DateTimeInput
              id={`${id}-day`}
              type="date"
              value={day}
              onChange={(value) => setDay(value.slice(0, 10))}
            />
          </div>
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-from`}>{t("helpDeskFrom")}</Label>
              <Input
                id={`${id}-from`}
                type="time"
                step={900}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                aria-invalid={Boolean(message)}
                aria-describedby={`${id}-status`}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-to`}>{t("helpDeskTo")}</Label>
              <Input
                id={`${id}-to`}
                type="time"
                step={900}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                aria-invalid={Boolean(message)}
                aria-describedby={`${id}-status`}
              />
            </div>
          </div>
          <p
            id={`${id}-status`}
            role={message ? "alert" : undefined}
            className={message ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {message ?? [summary, zoneHint].filter(Boolean).join(" · ")}
          </p>
        </fieldset>
        {error ? (
          <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={pending} disabled={Boolean(problem)}>
            {t("helpDeskAddInterval")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
