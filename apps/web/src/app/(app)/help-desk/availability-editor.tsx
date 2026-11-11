"use client";
import { endOfEventDay, instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
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
import { daysFrom, durationMinutes, eventDay, intervalProblem, mergeInterval } from "./schedule";

/**
 * Planned availability (H62): the saved intervals as rows per event day, an
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
  // The intervals as the person just left them, shown until the server answers so a drop does not jump back.
  const [optimistic, setOptimistic] = useState<AvailabilityInterval[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function replace(intervals: AvailabilityInterval[]) {
    setPending(true);
    setError(null);
    setOptimistic(intervals);
    try {
      onSaved(await api.put<MyHelperProfile>(path, { intervals }));
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setPending(false);
      setOptimistic(null);
    }
  }

  /** A refused drag is a quick notice, not a failure that needs dismissing. */
  const rejectDrag = (problem: string) =>
    toast.warning(problem, { compactTitle: t("toastAvailability"), duration: 5_000 });
  const window = profile.suggestedInterval;
  const startsAllowed = (interval: AvailabilityInterval) =>
    !window || Date.parse(interval.startsAt) >= Date.parse(window.startsAt);
  const notAfter = window ? endOfEventDay(window.endsAt, zone) : null;
  const endsAllowed = (interval: AvailabilityInterval) =>
    !notAfter || Date.parse(interval.endsAt) <= Date.parse(notAfter);
  const plannedDays = window ? hackingDays(window, zone) : [];
  /** A drawn stretch joins what it overlaps, so the result covers both. */
  function place(interval: AvailabilityInterval, others: AvailabilityInterval[]) {
    if (!startsAllowed(interval)) return rejectDrag(t("helpDeskIntervalBeforeHacking"));
    if (!endsAllowed(interval)) return rejectDrag(t("helpDeskIntervalAfterLastDay"));
    const merged = mergeInterval(others, interval);
    const touched = merged.find(
      (item) =>
        Date.parse(item.startsAt) <= Date.parse(interval.startsAt) &&
        Date.parse(item.endsAt) >= Date.parse(interval.endsAt),
    );
    if (touched && intervalProblem(touched, []) === "tooLong") {
      return rejectDrag(t("helpDeskIntervalTooLong"));
    }
    void replace(merged);
  }
  function prefillFor(day: string): AvailabilityInterval | null {
    if (!window) return null;
    const clock = instantToWallClock(window.startsAt, zone).slice(10, 16);
    const startsAt = wallClockToInstant(`${day}${clock}`, zone);
    if (!startsAt) return null;
    const start = Date.parse(startsAt);
    const end = Math.min(
      Date.parse(notAfter ?? window.endsAt),
      Math.max(start + 3_600_000, Math.min(start + 2 * 3_600_000, Date.parse(window.endsAt))),
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
        intervals={optimistic ?? profile.availability}
        days={plannedDays}
        fixedDays={Boolean(window)}
        notBefore={window?.startsAt}
        onCreate={(interval) => {
          if (!pending) place(interval, profile.availability);
        }}
        onChange={(interval, next) => {
          if (pending) return;
          place(
            next,
            profile.availability.filter((item) => item.startsAt !== interval.startsAt),
          );
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
          notAfter={notAfter}
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

/** One line for each hacking day; stored out-of-window intervals cannot add lines. */
function hackingDays(window: AvailabilityInterval, zone: string): string[] {
  return daysFrom(eventDay(window.startsAt, zone), eventDay(window.endsAt, zone));
}

function AddIntervalDialog({
  existing,
  suggested,
  editing,
  notBefore,
  notAfter,
  pending,
  error,
  onClose,
  onAdd,
  onRemove,
}: {
  /** Nobody is available before the hacking time (H62). */
  notBefore?: string;
  notAfter?: string | null;
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
        if (notAfter && Date.parse(interval.endsAt) > Date.parse(notAfter))
          return t("helpDeskIntervalAfterLastDay");
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
