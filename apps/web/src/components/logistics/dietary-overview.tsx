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
import { RSVP_KINDS, type RsvpKind } from "@/lib/rsvp";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";

type Label = Record<string, string>;

interface DietaryOverviewData {
  people: number;
  peopleByKind: Partial<Record<RsvpKind, number>>;
  withRestrictions: number;
  withNotes: number;
  /** The whole catalog, including entries nobody declared (n = 0). */
  byIntolerance: { id: number; label: Label; n: number }[];
  entries: {
    userId: number;
    name: string | null;
    surname: string | null;
    kind: RsvpKind;
    enterprise: string | null;
    intolerances: { id: number; label: Label }[];
    notes: string | null;
  }[];
}

type Entry = DietaryOverviewData["entries"][number];
/** A catalog intolerance id, or every entry with free-text notes. */
type Selection = number | "notes";

const KIND_LABEL = {
  participant: "rsvpKindParticipant",
  mentor: "rsvpKindMentor",
  sponsor: "rsvpKindSponsor",
  staff: "rsvpKindStaff",
} as const;

const label = (l: Label, language: string) =>
  l[language] ?? l.en ?? l.es ?? Object.values(l)[0] ?? "";

const matches = (entry: Entry, selection: Selection | null) =>
  selection === null ||
  (selection === "notes" ? !!entry.notes : entry.intolerances.some((i) => i.id === selection));

/**
 * Every attendee's food intolerances and free-text notes, for catering
 * (meal-plans:export). A tally of the whole catalog, scoped by attendance kind,
 * doubles as the filter for the list below it; notes are a tally row too, so the
 * people who wrote one are a click away.
 */
export function DietaryOverview() {
  const { t, language } = useLocale();
  const data = useServerResource(["logistics", "dietary"], (signal) =>
    api.get<DietaryOverviewData>("/api/logistics/dietary", { signal }),
  );
  const [kind, setKind] = useState<RsvpKind | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState("");

  const ofKind = useMemo(
    () => (data.data?.entries ?? []).filter((entry) => kind === null || entry.kind === kind),
    [data.data, kind],
  );

  const tally = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of ofKind)
      for (const item of entry.intolerances) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    return (data.data?.byIntolerance ?? [])
      .map((item) => ({
        id: item.id,
        label: label(item.label, language),
        n: counts.get(item.id) ?? 0,
      }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, language));
  }, [data.data, ofKind, language]);

  const shown = useMemo(() => {
    const needle = normalizeSearchText(query);
    return ofKind.filter((entry) => {
      if (!matches(entry, selection)) return false;
      if (!needle) return true;
      const haystack = normalizeSearchText(
        [
          entry.name,
          entry.surname,
          entry.enterprise,
          entry.notes,
          ...entry.intolerances.map((i) => label(i.label, language)),
        ].join(" "),
      );
      return haystack.includes(needle);
    });
  }, [ofKind, selection, query, language]);

  if (data.error && !data.data)
    return (
      <ContextualError
        message={apiErrorText(data.error, t, t("couldNotLoadDietary"))}
        onRetry={data.reload}
      />
    );
  if (!data.data) return <Spinner className="size-6" />;
  if (data.data.entries.length === 0) return <EmptyState title={t("dietaryNone")} />;

  const { peopleByKind, people: everyone } = data.data;
  const kinds = RSVP_KINDS.filter((k) => (peopleByKind[k] ?? 0) > 0);
  const people = kind === null ? everyone : (peopleByKind[kind] ?? 0);
  const withRestrictions = ofKind.filter((e) => e.intolerances.length > 0).length;
  const withNotes = ofKind.filter((e) => e.notes).length;
  const max = Math.max(1, withNotes, ...tally.map((row) => row.n));
  const toggle = (next: Selection) => setSelection(selection === next ? null : next);

  return (
    <div className="space-y-6">
      {kinds.length > 1 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t("dietaryKindFilter")}</legend>
          {[null, ...kinds].map((k) => (
            <Button
              key={k ?? "all"}
              type="button"
              size="sm"
              variant={kind === k ? "default" : "outline"}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === null ? t("dietaryEveryone") : t(KIND_LABEL[k])} ·{" "}
              {k === null ? everyone : peopleByKind[k]}
            </Button>
          ))}
        </fieldset>
      )}

      <section className="space-y-3">
        <p className="text-muted-foreground text-sm tabular-nums">
          {t("dietarySummary", { people, restrictions: withRestrictions, notes: withNotes })}
        </p>
        <ul aria-label={t("dietaryFilter")} className="space-y-0.5">
          {tally.map((row) => (
            <TallyRow
              key={row.id}
              label={row.label}
              n={row.n}
              max={max}
              selected={selection === row.id}
              onToggle={() => toggle(row.id)}
            />
          ))}
          <li aria-hidden className="my-1.5 border-t border-border/60" />
          <TallyRow
            label={t("dietaryWithNotes")}
            n={withNotes}
            max={max}
            selected={selection === "notes"}
            onToggle={() => toggle("notes")}
          />
        </ul>
      </section>

      <section className="space-y-3">
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
              <li key={entry.userId} className="space-y-1.5 px-4 py-3 text-sm">
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
                  <p className="border-l-2 border-border pl-3 whitespace-pre-line wrap-anywhere">
                    {entry.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One tally line: label, a bar scaled to the largest count, and the count. Toggles the list filter. */
function TallyRow({
  label,
  n,
  max,
  selected,
  onToggle,
}: {
  label: string;
  n: number;
  max: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        disabled={n === 0}
        onClick={onToggle}
        className={cn(
          "button-interaction grid w-full grid-cols-[8rem_1fr_2.5rem] sm:grid-cols-[14rem_1fr_2.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm",
          "enabled:hover:bg-accent/50 disabled:text-muted-foreground",
          selected && "bg-accent",
        )}
      >
        <span className={cn("truncate", selected && "font-medium")}>{label}</span>
        <span aria-hidden className="h-2 overflow-hidden rounded-full bg-foreground/10">
          <span
            className={cn("block h-full rounded-full", selected ? "bg-primary" : "bg-primary/60")}
            style={{ width: `${(n / max) * 100}%` }}
          />
        </span>
        <span className="text-right font-medium tabular-nums">{n}</span>
      </button>
    </li>
  );
}
