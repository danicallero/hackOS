"use client";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { MAX_AVAILABILITY_INTERVALS, MAX_INTERVAL_MS } from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useId, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatDurationMinutes } from "@/lib/datetime";
import { useEventTimeZone, useEventZoneHint } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import type { AvailabilityInterval, MyHelperProfile } from "./model";
import { durationMinutes, intervalProblem } from "./schedule";
import { ScheduleDays } from "./schedule-view";

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
  const [editing, setEditing] = useState<AvailabilityInterval | null>(null);
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
        <h3 className="type-label">{t("helpDeskPlanTitle")}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || profile.availability.length >= MAX_AVAILABILITY_INTERVALS}
          onClick={() => {
            setError(null);
            setEditing(null);
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
        onEdit={(interval) => {
          setError(null);
          setEditing(interval);
          setAdding(true);
        }}
        onRemove={(removed) =>
          void replace(profile.availability.filter((item) => item.startsAt !== removed.startsAt))
        }
      />
      <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskPlanNote")}</p>
      {error && !adding ? (
        <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
      ) : null}
      {adding ? (
        <AddIntervalDialog
          existing={profile.availability.filter((item) => item.startsAt !== editing?.startsAt)}
          suggested={editing ?? profile.suggestedInterval}
          editing={!!editing}
          pending={pending}
          error={error}
          onClose={() => setAdding(false)}
          onAdd={async (interval) => {
            if (
              await replace(
                editing
                  ? profile.availability.map((item) =>
                      item.startsAt === editing.startsAt ? interval : item,
                    )
                  : [...profile.availability, interval],
              )
            )
              setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AddIntervalDialog({
  existing,
  suggested,
  editing,
  pending,
  error,
  onClose,
  onAdd,
}: {
  existing: AvailabilityInterval[];
  editing: boolean;
  suggested: AvailabilityInterval | null | undefined;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onAdd: (interval: AvailabilityInterval) => void;
}) {
  const { t, language } = useLocale();
  const id = useId();
  const zone = useEventTimeZone();
  const zoneHint = useEventZoneHint(language);
  // Prefilled with the event's hacking window; every field stays editable.
  const [from, setFrom] = useState(() =>
    instantToWallClock(suggested?.startsAt ?? "", zone).slice(0, 16),
  );
  const [to, setTo] = useState(() =>
    instantToWallClock(
      suggested
        ? new Date(
            Math.min(
              Date.parse(suggested.endsAt),
              Date.parse(suggested.startsAt) + MAX_INTERVAL_MS,
            ),
          ).toISOString()
        : "",
      zone,
    ).slice(0, 16),
  );
  const [submitted, setSubmitted] = useState(false);
  const startsAt = from ? wallClockToInstant(from, zone) : null;
  const endsAt = to ? wallClockToInstant(to, zone) : null;
  const ordered = startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const interval = startsAt && endsAt && ordered ? { startsAt, endsAt } : null;
  const problem = interval ? intervalProblem(interval, existing) : null;
  const message =
    !startsAt || !endsAt
      ? submitted
        ? t("helpDeskIntervalIncomplete")
        : null
      : !ordered
        ? t("helpDeskIntervalOrder")
        : problem === "overlap"
          ? t("helpDeskIntervalOverlap")
          : problem === "tooLong"
            ? t("helpDeskIntervalTooLong")
            : null;
  const summary = interval && !problem ? formatDurationMinutes(durationMinutes(interval), t) : null;
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={t(editing ? "helpDeskEditIntervalTitle" : "helpDeskAddInterval")}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // The dialog renders inside the helper form's React tree.
          event.stopPropagation();
          setSubmitted(true);
          if (interval && !problem) onAdd(interval);
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
            {t(editing ? "saveChanges" : "helpDeskAddInterval")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
