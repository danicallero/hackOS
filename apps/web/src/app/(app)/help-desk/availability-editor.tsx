"use client";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { MAX_AVAILABILITY_INTERVALS, MAX_INTERVAL_MS } from "@hackos/shared/help-desk";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatDurationMinutes } from "@/lib/datetime";
import { useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { AvailabilityTimeline } from "./availability-timeline";
import { IntervalDialog } from "./interval-dialog";
import type { AvailabilityInterval, MyHelperProfile } from "./model";
import { durationMinutes, eventDay, intervalFrom, intervalProblem, nextDayOf } from "./schedule";

/**
 * Stated availability (H62): the saved intervals as rows per event day, an
 * Add dialog (day, from, to) and a Remove action per row. Each change saves
 * the complete replacement immediately, so there is no draft to lose.
 */
export function AvailabilityEditor({
  profile,
  onSaved,
  path = "/api/me/helper-profile/availability",
}: {
  profile: MyHelperProfile;
  onSaved: (profile: MyHelperProfile) => void;
  /** User management writes another person's availability through its own route. */
  path?: string;
}) {
  const { t } = useLocale();
  const zone = useEventTimeZone();
  const [adding, setAdding] = useState(false);
  const [dayPrefill, setDayPrefill] = useState<AvailabilityInterval | null>(null);
  const [editing, setEditing] = useState<AvailabilityInterval | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function replace(intervals: AvailabilityInterval[]) {
    setPending(true);
    setError(null);
    try {
      onSaved(await api.put<MyHelperProfile>(path, { intervals }));
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(false);
    }
  }

  const window = profile.suggestedInterval;
  const startsAllowed = (interval: AvailabilityInterval) =>
    !window || Date.parse(interval.startsAt) >= Date.parse(window.startsAt);
  const plannedDays = window ? hackingDays(window, zone) : [];
  function prefillFor(day: string): AvailabilityInterval | null {
    if (!window) return null;
    const clock = instantToWallClock(window.startsAt, zone).slice(10, 16);
    const startsAt = wallClockToInstant(`${day}${clock}`, zone);
    if (!startsAt) return null;
    const start = Date.parse(startsAt);
    const end = Math.max(
      start + 3_600_000,
      Math.min(start + 2 * 3_600_000, Date.parse(window.endsAt)),
    );
    return { startsAt, endsAt: new Date(end).toISOString() };
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-(--control-height-compact) items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t("helpDeskPlanTitle")}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || profile.availability.length >= MAX_AVAILABILITY_INTERVALS}
          onClick={() => {
            setError(null);
            setEditing(null);
            setDayPrefill(null);
            setAdding(true);
          }}
        >
          <PlusIcon aria-hidden="true" />
          {t("helpDeskAddInterval")}
        </Button>
      </div>
      <AvailabilityTimeline
        intervals={profile.availability}
        days={plannedDays}
        disabled={pending}
        onDrag={(day, startMinute, endMinute) => {
          const clock = (minute: number) =>
            `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          const interval = intervalFrom(day, clock(startMinute), clock(endMinute), zone);
          if (!interval) return;
          const problem = !startsAllowed(interval)
            ? t("helpDeskIntervalBeforeHacking")
            : intervalProblem(interval, profile.availability) === "overlap"
              ? t("helpDeskIntervalOverlap")
              : null;
          if (problem) toast.error(problem, t("helpDeskPlanTitle"));
          else void replace([...profile.availability, interval]);
        }}
        onAddDay={(day) => {
          setError(null);
          setEditing(null);
          setDayPrefill(prefillFor(day));
          setAdding(true);
        }}
        onEdit={(interval) => {
          setError(null);
          setEditing(interval);
          setAdding(true);
        }}
      />
      <p className="text-muted-foreground text-sm text-pretty">{t("helpDeskPlanNote")}</p>
      {error && !adding ? (
        <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
      ) : null}
      {adding ? (
        <AddIntervalDialog
          existing={profile.availability.filter((item) => item.startsAt !== editing?.startsAt)}
          suggested={editing ?? dayPrefill ?? profile.suggestedInterval}
          editing={!!editing}
          notBefore={window?.startsAt}
          pending={pending}
          error={error}
          onClose={() => setAdding(false)}
          onRemove={
            editing
              ? async () => {
                  if (
                    await replace(
                      profile.availability.filter((item) => item.startsAt !== editing.startsAt),
                    )
                  )
                    setAdding(false);
                }
              : undefined
          }
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

/** Every event day of the hacking (else event) window, at most two weeks. */
function hackingDays(window: AvailabilityInterval, zone: string): string[] {
  const last = eventDay(window.endsAt, zone);
  const days: string[] = [];
  for (let day = eventDay(window.startsAt, zone); day && day <= last && days.length < 14; ) {
    days.push(day);
    day = nextDayOf(day);
  }
  return days;
}

function AddIntervalDialog({
  existing,
  suggested,
  editing,
  notBefore,
  pending,
  error,
  onClose,
  onAdd,
  onRemove,
}: {
  /** Nobody is available before the hacking time (H62). */
  notBefore?: string;
  existing: AvailabilityInterval[];
  editing: boolean;
  suggested: AvailabilityInterval | null | undefined;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onAdd: (interval: AvailabilityInterval) => void;
  onRemove?: () => void;
}) {
  const { t } = useLocale();
  // Prefilled with the event's hacking window, at most one interval long.
  const initial = suggested
    ? {
        startsAt: suggested.startsAt,
        endsAt: new Date(
          Math.min(Date.parse(suggested.endsAt), Date.parse(suggested.startsAt) + MAX_INTERVAL_MS),
        ).toISOString(),
      }
    : null;
  return (
    <IntervalDialog
      title={t(editing ? "helpDeskEditIntervalTitle" : "helpDeskAddInterval")}
      submitLabel={t(editing ? "saveChanges" : "helpDeskAddInterval")}
      initial={initial}
      incompleteMessage={t("helpDeskIntervalIncomplete")}
      validate={(interval) => {
        if (notBefore && Date.parse(interval.startsAt) < Date.parse(notBefore)) {
          return t("helpDeskIntervalBeforeHacking");
        }
        const problem = intervalProblem(interval, existing);
        return problem === "overlap"
          ? t("helpDeskIntervalOverlap")
          : problem === "tooLong"
            ? t("helpDeskIntervalTooLong")
            : null;
      }}
      summary={(interval) => formatDurationMinutes(durationMinutes(interval), t)}
      pending={pending}
      error={error}
      onClose={onClose}
      onSave={onAdd}
      onRemove={onRemove}
    />
  );
}
