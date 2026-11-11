"use client";

import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { formatEventDate } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { logisticsApi, resolveScheduleText } from "@/lib/logistics";
import type { RsvpPerson, RsvpSummary } from "@/lib/rsvp";
import { cn } from "@/lib/utils";

const ANSWERS = ["yes", "no", "unsure", "unanswered"] as const;
type Answer = (typeof ANSWERS)[number];
const LABEL: Record<Answer, MessageKey> = {
  yes: "rsvpYes",
  no: "rsvpNo",
  unsure: "rsvpUnsure",
  unanswered: "rsvpUnanswered",
};
const COUNT_KEY: Record<Answer, "attending" | "notAttending" | "unsure" | "unanswered"> = {
  yes: "attending",
  no: "notAttending",
  unsure: "unsure",
  unanswered: "unanswered",
};
const KIND_LABEL = {
  participant: "rsvpKindParticipant",
  mentor: "rsvpKindMentor",
  sponsor: "rsvpKindSponsor",
  staff: "rsvpKindStaff",
} as const;

/**
 * Organizer view of attendance: only schedule entries marked as asking at least
 * one attendance kind, with the live counts and, per entry, who answered what.
 * It is read-only; asking is switched on when the entry is created or edited
 * in Manage Schedule.
 */
export function RsvpOverview() {
  const { t, language } = useLocale();
  const schedule = useServerResource(["logistics", "rsvp-schedule"], () => logisticsApi.schedule());
  const summaries = useServerResource(["logistics", "rsvp-summaries"], (signal) =>
    api.get<{ activities: RsvpSummary[] }>("/api/logistics/rsvps", { signal }),
  );
  const [open, setOpen] = useState<number | null>(null);

  const asked = useMemo(
    () => new Map((summaries.data?.activities ?? []).map((a) => [a.scheduleId, a])),
    [summaries.data],
  );
  const items = useMemo(
    () =>
      (schedule.data?.items ?? [])
        .filter((item) => asked.has(item.id))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [asked, schedule.data],
  );

  const error = schedule.error ?? summaries.error;
  if (error && !schedule.data)
    return (
      <ContextualError
        message={apiErrorText(error, t, t("couldNotLoadRsvps"))}
        onRetry={() => {
          schedule.reload();
          summaries.reload();
        }}
      />
    );
  if (!schedule.data || !summaries.data) return <Spinner className="size-6" />;
  if (items.length === 0) return <EmptyState title={t("rsvpNoAskedActivities")} />;

  return (
    <ul className="divide-y divide-border/60 rounded-surface border">
      {items.map((item) => {
        const summary = asked.get(item.id) as RsvpSummary;
        const expanded = open === item.id;
        const panelId = `rsvp-panel-${item.id}`;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : item.id)}
              className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left hover:bg-accent/50"
            >
              <span className="min-w-0 flex-1 basis-56">
                <span className="block font-medium wrap-anywhere">
                  {resolveScheduleText(item, language).title}
                </span>
                <span className="text-muted-foreground block text-sm tabular-nums">
                  {formatEventDate(item.startsAt, language, "dateTime")}
                </span>
              </span>
              <Counts summary={summary} />
              <CaretDownIcon
                aria-hidden
                className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
              />
            </button>
            {expanded && (
              <div id={panelId} className="border-t border-border/60 px-4 py-4">
                <People summary={summary} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Counts({ summary }: { summary: RsvpSummary }) {
  const { t } = useLocale();
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
      {ANSWERS.map((answer) => (
        <div key={answer} className="flex items-baseline gap-1.5">
          <dt className="text-muted-foreground">{t(LABEL[answer])}</dt>
          <dd className="font-medium">{summary[COUNT_KEY[answer]]}</dd>
        </div>
      ))}
    </dl>
  );
}

function People({ summary }: { summary: RsvpSummary }) {
  const { t } = useLocale();
  const people = useServerResource(["logistics", "rsvp-people", summary.activityId], (signal) =>
    api.get<{ people: RsvpPerson[] }>(`/api/logistics/rsvps/${summary.activityId}/people`, {
      signal,
    }),
  );
  const [filter, setFilter] = useState<Answer>("yes");
  if (people.error && !people.data)
    return (
      <ContextualError
        message={apiErrorText(people.error, t, t("couldNotLoadRsvps"))}
        onRetry={people.reload}
      />
    );
  if (!people.data) return <Spinner className="size-5" />;
  const shown = people.data.people.filter((p) => p.state === filter);
  return (
    <section className="space-y-3">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t("rsvpAnswersTitle")}</legend>
        {ANSWERS.map((answer) => (
          <Button
            key={answer}
            type="button"
            size="sm"
            variant={filter === answer ? "default" : "outline"}
            aria-pressed={filter === answer}
            onClick={() => setFilter(answer)}
          >
            {t(LABEL[answer])} · {summary[COUNT_KEY[answer]]}
          </Button>
        ))}
      </fieldset>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("rsvpNobody")}</p>
      ) : (
        <ul className="divide-y divide-border/60 text-sm">
          {shown.map((person) => (
            <li
              key={person.userId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5"
            >
              <span className="font-medium wrap-anywhere">
                {[person.name, person.surname].filter(Boolean).join(" ")}
              </span>
              <span className="text-muted-foreground">
                {[t(KIND_LABEL[person.kind]), person.enterprise].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
