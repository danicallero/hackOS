"use client";

import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Column } from "@/components/common/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { type Translate, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { cn } from "@/lib/utils";
import { type ChallengeOption, challengeTitleText } from "../projects/shared";

/** A public profile card (`DirectoryEntry`, #934), as `GET /api/me/diary` carries it. */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  locationNote: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

/** Localized challenge title by id; the API's `name` is the fallback. */
export type ChallengeName = (challenge: { id: number; name: string }) => string;

/** Avatar, name and headline; the whole row is the link, not this name. */
export function Person({ entry }: { entry: DirectoryEntry }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size="lg">
        {entry.photoUrl && <AvatarImage src={apiAssetUrl(entry.photoUrl)} alt="" />}
        <AvatarFallback>{initials(entry.displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="wrap-break-word font-medium">{entry.displayName}</p>
        {entry.headline && (
          <p className="text-muted-foreground wrap-break-word text-sm">{entry.headline}</p>
        )}
      </div>
    </div>
  );
}

export function Challenges({
  entry,
  nameOf,
}: {
  entry: Pick<DirectoryEntry, "challenges">;
  nameOf: ChallengeName;
}) {
  if (entry.challenges.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entry.challenges.map((challenge) => (
        <li
          key={challenge.id}
          className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
        >
          {nameOf(challenge)}
        </li>
      ))}
    </ul>
  );
}

/** The private note under a saved person's name. */
export function NoteLine({ note }: { note: string }) {
  return (
    <p className="text-muted-foreground line-clamp-2 text-sm whitespace-pre-line wrap-break-word italic">
      {note}
    </p>
  );
}

/** A saved person row: identity first, then the diary actions. */
export interface PersonRowModel {
  key: string;
  /** null for a saved person who no longer shares a profile. */
  person: DirectoryEntry | null;
  note: string | null;
  actions: React.ReactNode;
}

function Unavailable({ t }: { t: Translate }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback>?</AvatarFallback>
      </Avatar>
      <p className="text-muted-foreground">{t("diaryPersonUnavailable")}</p>
    </div>
  );
}

/** Desktop columns of the diary's People tab (#934, #935). */
export function personColumns<R extends PersonRowModel>(
  t: Translate,
  nameOf: ChallengeName,
): Column<R>[] {
  const dash = <span className="text-muted-foreground">—</span>;
  return [
    {
      id: "name",
      header: t("name"),
      className: "whitespace-normal",
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          {row.person ? <Person entry={row.person} /> : <Unavailable t={t} />}
          {row.note && (
            <div className="pl-13">
              <NoteLine note={row.note} />
            </div>
          )}
        </div>
      ),
    },
    {
      id: "project",
      header: t("colProject"),
      cell: (row) =>
        row.person?.project ? (
          <span className="wrap-break-word">{row.person.project.name}</span>
        ) : (
          dash
        ),
    },
    {
      id: "challenges",
      header: t("challenges"),
      cell: (row) => (row.person ? <Challenges entry={row.person} nameOf={nameOf} /> : dash),
    },
    {
      id: "location",
      header: t("colLocation"),
      cell: (row) =>
        row.person?.locationNote ? (
          <span className="wrap-break-word">{row.person.locationNote}</span>
        ) : (
          dash
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("diary")}</span>,
      align: "right",
      cell: (row) => row.actions,
    },
  ];
}

export function personHref(row: PersonRowModel): string | null {
  return row.person ? `/people/${row.person.userId}` : null;
}

/**
 * Narrow-screen person row: the whole row is the link (stretched over it, with
 * a full-width hover and pressed state); the trailing actions sit above it.
 */
export function PersonMobileRow({
  row,
  t,
  nameOf,
}: {
  row: PersonRowModel;
  t: Translate;
  nameOf: ChallengeName;
}) {
  const { person } = row;
  const href = personHref(row);
  const details = person && (person.project || person.challenges.length > 0 || person.locationNote);
  return (
    <div
      className={cn(
        "relative min-w-0 space-y-2 px-4 py-3 transition-colors",
        href && "hover:bg-muted/50 has-[a:active]:bg-muted",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {person && href ? (
          <Link
            href={href}
            className="min-w-0 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            <Person entry={person} />
          </Link>
        ) : (
          <Unavailable t={t} />
        )}
        <div className="relative z-10 shrink-0">{row.actions}</div>
      </div>
      {(details || row.note) && (
        <div className="space-y-1.5 pl-13 text-sm">
          {person?.project && <p className="wrap-break-word">{person.project.name}</p>}
          {person && person.challenges.length > 0 && (
            <div className="flex items-start gap-2">
              <TrophyIcon
                className="text-muted-foreground mt-1 size-3.5 shrink-0"
                aria-label={t("challenges")}
              />
              <Challenges entry={person} nameOf={nameOf} />
            </div>
          )}
          {person?.locationNote && (
            <p className="text-muted-foreground flex items-start gap-2">
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-label={t("colLocation")} />
              <span className="min-w-0 wrap-break-word">{person.locationNote}</span>
            </p>
          )}
          {row.note && <NoteLine note={row.note} />}
        </div>
      )}
    </div>
  );
}

/**
 * Localized challenge titles from `GET /api/public/challenges`, shared by the
 * diary's people rows and stand album (#935). The API's `name` is the fallback.
 */
export function useChallengeNames() {
  const { language } = useLocale();
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: ChallengeOption[] }>("/api/public/challenges")
      .then((r) => {
        if (!cancelled) setChallenges(r.items);
      })
      .catch(() => {
        // Chips fall back to the API's names.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const titles = useMemo(
    () => new Map(challenges.map((c) => [c.id, challengeTitleText(c.title, language)])),
    [challenges, language],
  );
  const nameOf = useCallback<ChallengeName>(
    (challenge) => titles.get(challenge.id) || challenge.name,
    [titles],
  );
  return { nameOf };
}
