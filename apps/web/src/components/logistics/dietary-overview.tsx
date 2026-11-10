"use client";

import { useMemo, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { SearchField } from "@/components/common/search-field";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import type { RsvpKind } from "@/lib/rsvp";

interface DietaryOverviewData {
  people: number;
  withRestrictions: number;
  withNotes: number;
  byIntolerance: { id: number; label: Record<string, string>; n: number }[];
  entries: {
    userId: number;
    name: string | null;
    surname: string | null;
    kind: RsvpKind;
    enterprise: string | null;
    intolerances: { id: number; label: Record<string, string> }[];
    notes: string | null;
  }[];
}

const KIND_LABEL = {
  participant: "rsvpKindParticipant",
  mentor: "rsvpKindMentor",
  sponsor: "rsvpKindSponsor",
  staff: "rsvpKindStaff",
} as const;

const label = (l: Record<string, string>, language: string) =>
  l[language] ?? l.en ?? l.es ?? Object.values(l)[0] ?? "";

/**
 * Every attendee's food intolerances and free-text notes in one list, for
 * catering (meal-plans:export). Filter by intolerance or search names and notes.
 */
export function DietaryOverview() {
  const { t, language } = useLocale();
  const data = useServerResource(["logistics", "dietary"], (signal) =>
    api.get<DietaryOverviewData>("/api/logistics/dietary", { signal }),
  );
  const [intolerance, setIntolerance] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data.data?.entries ?? []).filter((entry) => {
      if (intolerance !== null && !entry.intolerances.some((i) => i.id === intolerance))
        return false;
      if (!needle) return true;
      const haystack = [
        entry.name,
        entry.surname,
        entry.enterprise,
        entry.notes,
        ...entry.intolerances.map((i) => label(i.label, language)),
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [data.data, intolerance, query, language]);

  if (data.error && !data.data)
    return (
      <ContextualError
        message={apiErrorText(data.error, t, t("couldNotLoadDietary"))}
        onRetry={data.reload}
      />
    );
  if (!data.data) return <Spinner className="size-6" />;
  const { people, withRestrictions, withNotes, byIntolerance } = data.data;
  if (data.data.entries.length === 0) return <EmptyState title={t("dietaryNone")} />;

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("dietarySummary", { people, restrictions: withRestrictions, notes: withNotes })}
      </p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t("dietaryFilter")}</legend>
        <Button
          type="button"
          size="sm"
          variant={intolerance === null ? "default" : "outline"}
          aria-pressed={intolerance === null}
          onClick={() => setIntolerance(null)}
        >
          {t("dietaryAll")}
        </Button>
        {byIntolerance.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={intolerance === item.id ? "default" : "outline"}
            aria-pressed={intolerance === item.id}
            onClick={() => setIntolerance(intolerance === item.id ? null : item.id)}
          >
            {label(item.label, language)} · {item.n}
          </Button>
        ))}
      </fieldset>
      <SearchField
        label={t("dietarySearch")}
        value={query}
        onValueChange={setQuery}
        placeholder={t("dietarySearch")}
      />
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("rsvpNobody")}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-surface border">
          {shown.map((entry) => (
            <li key={entry.userId} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <span className="font-medium wrap-anywhere">
                  {[entry.name, entry.surname].filter(Boolean).join(" ")}
                </span>
                <span className="text-muted-foreground">
                  {[t(KIND_LABEL[entry.kind]), entry.enterprise].filter(Boolean).join(" · ")}
                </span>
              </div>
              {entry.intolerances.length > 0 && (
                <p>{entry.intolerances.map((i) => label(i.label, language)).join(", ")}</p>
              )}
              {entry.notes && (
                <p className="text-muted-foreground whitespace-pre-line wrap-anywhere">
                  {entry.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
