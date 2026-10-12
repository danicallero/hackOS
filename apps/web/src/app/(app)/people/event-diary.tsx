"use client";

import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { DataTable } from "@/components/common/data-table";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { useUrlTab } from "@/lib/url-tab";
import { CompanyCollection } from "./company-collection";
import {
  type DiaryHandlers,
  type DiaryMark,
  FavouritesToggle,
  NoteDialog,
  PersonActions,
  type SponsorCard,
} from "./diary-actions";
import {
  type DirectoryEntry,
  PersonMobileRow,
  type PersonRowModel,
  personColumns,
  personHref,
  useChallengeNames,
} from "./person-row";

export type { SponsorCard } from "./diary-actions";

/** `DiaryEntry` from `GET /api/me/diary` (#935). */
export interface DiaryEntry {
  id: number;
  kind: "person" | "sponsor";
  starred: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  person: DirectoryEntry | null;
  sponsor: SponsorCard | null;
}

/** Refetch on focus only when the list is older than this. */
const FOCUS_REFRESH_MS = 30_000;

/** The API orders favourites first, then newest; keep that after local edits. */
function sortEntries(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.starred) - Number(a.starred) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id - a.id,
  );
}

/** Accent- and case-insensitive text for the People search. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function searchText(entry: DiaryEntry): string {
  const person = entry.person;
  return fold(
    [
      person?.displayName,
      person?.headline,
      ...(person?.projects.map((project) => project.name) ?? []),
      person?.locationNote,
      ...(person?.challenges.map((challenge) => challenge.name) ?? []),
      entry.note,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * People destination (#935): the caller's event diary. People are the contacts
 * saved by scanning their badge (there is no browsable directory); Companies
 * is the separate collection of sponsor stands.
 */
export function EventDiary() {
  const { t } = useLocale();
  const { isPureApplicant } = useSessionContext();
  if (isPureApplicant) return <AccessDenied ask={t("diaryAccessDeniedDesc")} />;
  return <DiaryPage />;
}

type DiaryView = "people" | "companies";

const VIEWS: DiaryView[] = ["people", "companies"];

type PeopleRow = PersonRowModel & { entry: DiaryEntry };

function DiaryPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const { tab, setTab } = useUrlTab<DiaryView>({ values: VIEWS, defaultValue: "people" });
  const { nameOf } = useChallengeNames();

  const [entries, setEntries] = useState<DiaryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const loadedAt = useRef(0);
  const hasEntries = useRef(false);
  const liveRefresh = useAutoRefresh(`/api/events/stream?topic=${SSE_TOPICS.DIRECTORY}`, [
    EVENTS.DOMAIN_CHANGED,
  ]);

  useEffect(() => {
    function onFocus() {
      if (Date.now() - loadedAt.current > FOCUS_REFRESH_MS) setFocusNonce((n) => n + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonces are ping-only triggers that intentionally retrigger this effect.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .get<{ items: DiaryEntry[] }>("/api/me/diary")
      .then((r) => {
        if (cancelled) return;
        loadedAt.current = Date.now();
        hasEntries.current = true;
        setEntries(r.items);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : t("diaryCouldNotLoad");
        // A failed background refresh keeps what is already shown.
        if (hasEntries.current) toast.error(message, t("diary"));
        else setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [liveRefresh, focusNonce, retryNonce, t]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [noteTarget, setNoteTarget] = useState<(DiaryMark & { title: string }) | null>(null);
  const [removeTarget, setRemoveTarget] = useState<(DiaryMark & { title: string }) | null>(null);
  const [search, setSearch] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);

  const replaceEntry = useCallback((next: DiaryEntry) => {
    setEntries((current) =>
      sortEntries([...(current ?? []).filter((entry) => entry.id !== next.id), next]),
    );
  }, []);

  // Favouriting only marks a saved entry: it never adds or removes one (#935).
  const handlers = useMemo<DiaryHandlers>(
    () => ({
      busyId,
      onToggleStar: async (mark) => {
        setBusyId(mark.id);
        try {
          replaceEntry(
            await api.patch<DiaryEntry>(`/api/me/diary/${mark.id}`, { starred: !mark.starred }),
          );
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : t("diaryCouldNotSave"),
            t("diaryFavourite"),
          );
        } finally {
          setBusyId(null);
        }
      },
      onEditNote: (mark, title) => setNoteTarget({ ...mark, title }),
      onRemove: (mark, title) => setRemoveTarget({ ...mark, title }),
    }),
    [busyId, replaceEntry, t],
  );

  async function saveNote(note: string) {
    if (!noteTarget) return;
    setBusyId(noteTarget.id);
    try {
      replaceEntry(await api.patch<DiaryEntry>(`/api/me/diary/${noteTarget.id}`, { note }));
      setNoteTarget(null);
      toast.success(t("diaryNoteSaved"), { compactTitle: t("diaryNote") });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("diaryCouldNotSave"), t("diaryNote"));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    setBusyId(target.id);
    try {
      await api.delete(`/api/me/diary/${target.id}`);
      setEntries((current) => (current ?? []).filter((item) => item.id !== target.id));
      setRemoveTarget(null);
      toast.success(t("diaryRemoved"), { compactTitle: t("diaryRemoveTitle") });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("diaryCouldNotSave"),
        t("diaryRemoveTitle"),
      );
    } finally {
      setBusyId(null);
    }
  }

  const people = useMemo(
    () => (entries ?? []).filter((entry) => entry.kind === "person"),
    [entries],
  );

  const columns = useMemo(() => personColumns<PeopleRow>(t, nameOf), [t, nameOf]);
  const needle = fold(search.trim());
  const rows = useMemo<PeopleRow[]>(
    () =>
      people
        .filter((entry) => !favouritesOnly || entry.starred)
        .filter((entry) => !needle || searchText(entry).includes(needle))
        .map((entry) => {
          const name = entry.person?.displayName ?? t("diaryPersonUnavailable");
          return {
            key: String(entry.id),
            entry,
            person: entry.person,
            note: entry.note,
            actions: <PersonActions name={name} mark={entry} handlers={handlers} />,
          };
        }),
    [people, favouritesOnly, needle, handlers, t],
  );
  const filtering = needle.length > 0 || favouritesOnly;

  const peopleView = (
    <div className="space-y-4">
      {people.length > 0 && (
        <ListToolbar
          search={{
            id: "diary-search",
            label: t("searchPeople"),
            value: search,
            onValueChange: setSearch,
          }}
          actions={
            <FavouritesToggle
              pressed={favouritesOnly}
              onPressedChange={setFavouritesOnly}
              compact={isMobile}
            />
          }
        />
      )}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.key}
        getRowHref={personHref}
        getRowLabel={(row) => row.person?.displayName ?? t("diaryPersonUnavailable")}
        renderMobileRow={(row) => <PersonMobileRow row={row} t={t} nameOf={nameOf} />}
        loading={entries === null && !loadError}
        error={
          loadError
            ? { message: loadError, onRetry: () => setRetryNonce((value) => value + 1) }
            : undefined
        }
        empty={{ icon: AddressBookIcon, title: t("diaryEmpty") }}
        filteredEmpty={{
          active: filtering,
          onClear: () => {
            setSearch("");
            setFavouritesOnly(false);
          },
        }}
      />
    </div>
  );

  return (
    <PageLayout>
      <PageHeader title={t("diary")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabBar width="content" aria-label={t("diary")}>
          <TabsTrigger value="people">{t("diaryPeopleTab")}</TabsTrigger>
          <TabsTrigger value="companies">{t("diaryCompaniesTab")}</TabsTrigger>
        </TabBar>
        <TabsContent value="people" className="pt-2">
          {peopleView}
        </TabsContent>
        <TabsContent value="companies" className="pt-4">
          <CompanyCollection nameOf={nameOf} />
        </TabsContent>
      </Tabs>
      <NoteDialog
        target={noteTarget}
        pending={noteTarget !== null && busyId === noteTarget.id}
        onClose={() => setNoteTarget(null)}
        onSave={(note) => void saveNote(note)}
      />
      <AlertModal
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t("diaryRemoveTitle")}
        description={removeTarget?.title ?? ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={removeTarget !== null && busyId === removeTarget.id}
        onConfirm={() => void confirmRemove()}
      />
    </PageLayout>
  );
}
