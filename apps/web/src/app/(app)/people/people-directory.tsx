"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { ListToolbar } from "@/components/common/list-toolbar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { apiAssetUrl } from "@/lib/directory";
import { type Translate, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { type ChallengeOption, challengeTitleText } from "../projects/shared";
import { type DiaryHandlers, type DiaryMark, PersonActions } from "./diary-actions";
import { useDirectoryParams } from "./use-directory-params";

/** `DirectoryEntry` from `GET /api/directory` (#934). */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  locationNote: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

interface DirectoryPage {
  items: DirectoryEntry[];
  nextCursor: string | null;
}

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 250;

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

/**
 * Diary state for directory rows (#935): Save while not in the diary; once
 * saved, Favourite and the note/remove menu, exactly as on People.
 */
export interface DirectoryDiary {
  markFor: (userId: number) => DiaryMark | null;
  savingUserId: number | null;
  onSave: (entry: DirectoryEntry) => void;
  handlers: DiaryHandlers;
}

/** A person row in People or Directory: identity first, then the diary actions. */
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

/** Shared desktop columns of People and Directory (#934, #935). */
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
 * directory and the diary (#934, #935). The API's `name` is the fallback.
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
        // Chips fall back to the API's names; filters simply offer no options.
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
  return { challenges, nameOf };
}

/** Opt-in people directory over `GET /api/directory` (#934). */
export function PeopleDirectory({ diary }: { diary?: DirectoryDiary } = {}) {
  const { t } = useLocale();
  const canRead = useCan(CAPABILITIES.DIRECTORY_READ);
  // Gate before mounting the list, so a reader without access opens no fetch or stream.
  if (!canRead) return <AccessDenied ask={t("peopleAccessDeniedDesc")} />;
  return <DirectoryList diary={diary} />;
}

type DirectoryRow = PersonRowModel & { person: DirectoryEntry };

function DirectoryList({ diary }: { diary?: DirectoryDiary }) {
  const { t, language } = useLocale();
  const { params, setParams } = useDirectoryParams();
  const { q, challengeId, cursor } = params;

  // The field echoes keystrokes immediately; the URL (and the request) follow
  // after a short pause. Only a URL change this field did not write
  // (back/forward, a link) resets it — the echo of our own write must not
  // overwrite what was typed meanwhile (R003).
  const [search, setSearch] = useState(q);
  const [trackedQ, setTrackedQ] = useState(q);
  const [writtenQ, setWrittenQ] = useState<string | null>(null);
  if (q !== trackedQ) {
    setTrackedQ(q);
    setWrittenQ(null);
    if (q !== writtenQ) setSearch(q);
  }
  useEffect(() => {
    const next = search.trim();
    if (next === q) return;
    const handle = setTimeout(() => {
      setWrittenQ(next);
      setParams({ q: next, cursor: "" });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search, q, setParams]);

  // Earlier cursors of the current query, so Previous can step back.
  const [history, setHistory] = useState<string[]>([]);
  const queryKey = `${q}\u0000${challengeId}`;
  const [trackedQueryKey, setTrackedQueryKey] = useState(queryKey);
  if (queryKey !== trackedQueryKey) {
    setTrackedQueryKey(queryKey);
    setHistory([]);
  }

  const { challenges, nameOf } = useChallengeNames();

  const liveRefresh = useAutoRefresh(`/api/events/stream?topic=${SSE_TOPICS.DIRECTORY}`, [
    EVENTS.DOMAIN_CHANGED,
  ]);
  // `queryKey` records which query the page (and its nextCursor) belongs to.
  const [page, setPage] = useState<DirectoryPage & { queryKey: string | null }>({
    items: [],
    nextCursor: null,
    queryKey: null,
  });
  const [loading, setLoading] = useState(true);
  const loadedKey = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    let cancelled = false;
    const requestKey = `${queryKey}\u0000${cursor}`;
    // A live refresh keeps the current rows visible; a new query shows the skeleton.
    const isRefresh = loadedKey.current === requestKey;
    if (!isRefresh) setLoading(true);
    setLoadError(null);
    api
      .get<DirectoryPage>("/api/directory", {
        query: {
          q: q || undefined,
          challengeId: challengeId || undefined,
          cursor: cursor || undefined,
          limit: PAGE_SIZE,
        },
      })
      .then((r) => {
        if (cancelled) return;
        loadedKey.current = requestKey;
        setPage({ ...r, queryKey });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : t("couldNotLoadPeople");
        // A failed background refresh keeps the rows already shown.
        if (isRefresh) {
          toast.error(message, t("columnPeople"));
          return;
        }
        loadedKey.current = null;
        setPage({ items: [], nextCursor: null, queryKey: null });
        setLoadError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, challengeId, cursor, queryKey, liveRefresh, retryNonce, t]);

  const columns = useMemo(() => personColumns<DirectoryRow>(t, nameOf), [t, nameOf]);
  const rows = useMemo<DirectoryRow[]>(
    () =>
      page.items.map((person) => {
        const mark = diary?.markFor(person.userId) ?? null;
        return {
          key: String(person.userId),
          person,
          note: mark?.note ?? null,
          actions: diary ? (
            <PersonActions
              name={person.displayName}
              mark={mark}
              handlers={diary.handlers}
              showSaved
              save={{
                pending: diary.savingUserId === person.userId,
                disabled: diary.savingUserId !== null,
                onSave: () => diary.onSave(person),
              }}
            />
          ) : null,
        };
      }),
    [page.items, diary],
  );
  const challengeOptions = useMemo(
    () =>
      challenges
        .map((challenge) => ({
          value: String(challenge.id),
          label: challengeTitleText(challenge.title, language),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [challenges, language],
  );

  const filters: FilterDefinition[] = [
    {
      id: "challenge",
      label: t("challenges"),
      icon: TrophyIcon,
      type: "single",
      value: challengeId,
      resetValue: "",
      onChange: (value) => setParams({ challengeId: value, cursor: "" }),
      options: challengeOptions,
    },
  ];
  const hasFilters = q.length > 0 || challengeId.length > 0;
  const hasPrevious = cursor.length > 0;
  // A cursor from another query's page is never followed.
  const nextCursor = page.queryKey === queryKey ? page.nextCursor : null;

  function clearFilters() {
    setSearch("");
    setWrittenQ("");
    setParams({ q: "", challengeId: "", cursor: "" });
    document.getElementById("people-search")?.focus();
  }

  function goNext() {
    if (!nextCursor) return;
    setHistory((stack) => [...stack, cursor]);
    setParams({ cursor: nextCursor });
  }

  function goPrevious() {
    // A deep-linked cursor has no history; Previous then returns to the first page.
    const previous = history.at(-1) ?? "";
    setHistory((stack) => stack.slice(0, -1));
    setParams({ cursor: previous });
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        search={{
          id: "people-search",
          label: t("searchPeople"),
          value: search,
          onValueChange: setSearch,
        }}
        filters={challengeOptions.length > 0 || challengeId ? filters : undefined}
      />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.key}
        getRowHref={personHref}
        getRowLabel={(row) => row.person.displayName}
        renderMobileRow={(row) => <PersonMobileRow row={row} t={t} nameOf={nameOf} />}
        loading={loading}
        error={
          loadError
            ? { message: loadError, onRetry: () => setRetryNonce((value) => value + 1) }
            : undefined
        }
        empty={{ icon: UsersIcon, title: t("noPeopleYet") }}
        filteredEmpty={{ active: hasFilters, onClear: clearFilters }}
      />
      {(hasPrevious || nextCursor) && (
        <nav className="flex justify-end gap-2" aria-label={t("tablePagination")}>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !hasPrevious}
            onClick={goPrevious}
          >
            {t("previous")}
          </Button>
          <Button variant="outline" size="sm" disabled={loading || !nextCursor} onClick={goNext}>
            {t("next")}
          </Button>
        </nav>
      )}
    </div>
  );
}
