"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { AddressBookIcon } from "@phosphor-icons/react/dist/csr/AddressBook";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { TabBar } from "@/components/common/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useCan, useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { useUrlTab } from "@/lib/url-tab";
import { cn } from "@/lib/utils";
import {
  type ChallengeName,
  Challenges,
  type DirectoryEntry,
  type DirectorySaveAction,
  PeopleDirectory,
  Person,
  useChallengeNames,
} from "./people-directory";

/** Public sponsor card in a diary entry (`SponsorCard`, #935). */
export interface SponsorCard {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  description: string | null;
  website: string | null;
  challenges: { id: number; name: string }[];
}

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

const NOTE_MAX = 500;
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

function entryName(entry: DiaryEntry, t: Translate): string {
  return entry.person?.displayName ?? entry.sponsor?.name ?? t("diaryUnavailable");
}

function SponsorIdentity({ sponsor }: { sponsor: SponsorCard }) {
  const { t } = useLocale();
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Avatar size="lg" className="rounded-md">
        {sponsor.logoUrl ? (
          <SponsorLogo
            logoUrl={sponsor.logoUrl}
            logoNegativeUrl={sponsor.logoNegativeUrl}
            alt=""
            className="size-full object-contain"
          />
        ) : (
          <AvatarFallback className="rounded-md">{initials(sponsor.name)}</AvatarFallback>
        )}
      </Avatar>
      <div className="min-w-0 space-y-0.5">
        <p className="wrap-break-word font-medium">{sponsor.name}</p>
        {sponsor.description && (
          <p className="text-muted-foreground line-clamp-2 max-w-prose text-sm whitespace-normal">
            {sponsor.description}
          </p>
        )}
        {sponsor.website && (
          <a
            href={sponsor.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            <span className="truncate">{sponsor.website.replace(/^https?:\/\//, "")}</span>
            <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">{t("diaryOpensInNewTab")}</span>
          </a>
        )}
      </div>
    </div>
  );
}

function PersonIdentity({ person, t }: { person: DirectoryEntry; t: Translate }) {
  return (
    <div className="min-w-0 space-y-1">
      <Person entry={person} href={`/people/${person.userId}`} />
      {(person.project || person.locationNote) && (
        <div className="text-muted-foreground space-y-0.5 pl-13 text-sm">
          {person.project && <p className="wrap-break-word">{person.project.name}</p>}
          {person.locationNote && (
            <p className="flex items-start gap-1.5">
              <MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-label={t("colLocation")} />
              <span className="min-w-0 wrap-break-word">{person.locationNote}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Identity({ entry, t }: { entry: DiaryEntry; t: Translate }) {
  if (entry.person) return <PersonIdentity person={entry.person} t={t} />;
  if (entry.sponsor) return <SponsorIdentity sponsor={entry.sponsor} />;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size="lg" className={cn(entry.kind === "sponsor" && "rounded-md")}>
        <AvatarFallback className={cn(entry.kind === "sponsor" && "rounded-md")}>?</AvatarFallback>
      </Avatar>
      <p className="text-muted-foreground">
        {entry.kind === "person" ? t("diaryPersonUnavailable") : t("diaryUnavailable")}
      </p>
    </div>
  );
}

function entryChallenges(entry: DiaryEntry) {
  return entry.person?.challenges ?? entry.sponsor?.challenges ?? [];
}

interface RowHandlers {
  busyId: number | null;
  onToggleStar: (entry: DiaryEntry) => void;
  onEditNote: (entry: DiaryEntry) => void;
  onRemove: (entry: DiaryEntry) => void;
}

function StarButton({
  entry,
  handlers,
  t,
}: {
  entry: DiaryEntry;
  handlers: RowHandlers;
  t: Translate;
}) {
  return (
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={`${t("diaryFavourite")}: ${entryName(entry, t)}`}
      aria-pressed={entry.starred}
      disabled={handlers.busyId === entry.id}
      onClick={() => handlers.onToggleStar(entry)}
    >
      <StarIcon
        aria-hidden="true"
        weight={entry.starred ? "fill" : "regular"}
        className={cn("size-4", entry.starred ? "text-warning" : "text-muted-foreground")}
      />
    </IconButton>
  );
}

function RowMenu({
  entry,
  handlers,
  t,
}: {
  entry: DiaryEntry;
  handlers: RowHandlers;
  t: Translate;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={`${t("openMenuAria")}: ${entryName(entry, t)}`}
          disabled={handlers.busyId === entry.id}
        >
          <DotsThreeIcon aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handlers.onEditNote(entry)}>
          {entry.note ? t("diaryEditNote") : t("diaryAddNote")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => handlers.onRemove(entry)}>
          {t("remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteText({ note }: { note: string | null }) {
  if (!note) return <span className="text-muted-foreground">—</span>;
  return <p className="line-clamp-3 text-sm whitespace-pre-line wrap-break-word">{note}</p>;
}

function buildColumns(
  t: Translate,
  nameOf: ChallengeName,
  handlers: RowHandlers,
): Column<DiaryEntry>[] {
  return [
    {
      id: "star",
      header: <span className="sr-only">{t("diaryFavourite")}</span>,
      width: "w-12",
      cell: (entry) => <StarButton entry={entry} handlers={handlers} t={t} />,
    },
    {
      id: "name",
      header: t("name"),
      className: "whitespace-normal",
      cell: (entry) => <Identity entry={entry} t={t} />,
    },
    {
      id: "challenges",
      header: t("challenges"),
      cell: (entry) =>
        entry.person || entry.sponsor ? (
          <Challenges entry={{ challenges: entryChallenges(entry) }} nameOf={nameOf} />
        ) : null,
    },
    {
      id: "note",
      header: t("diaryNote"),
      width: "w-80",
      cell: (entry) => <NoteText note={entry.note} />,
    },
  ];
}

function DiaryMobileRow({
  entry,
  t,
  nameOf,
  handlers,
}: {
  entry: DiaryEntry;
  t: Translate;
  nameOf: ChallengeName;
  handlers: RowHandlers;
}) {
  const challenges = entryChallenges(entry);
  return (
    <div className="min-w-0 space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <Identity entry={entry} t={t} />
        <div className="flex shrink-0 items-center">
          <StarButton entry={entry} handlers={handlers} t={t} />
          <RowMenu entry={entry} handlers={handlers} t={t} />
        </div>
      </div>
      {(challenges.length > 0 || entry.note) && (
        <div className="space-y-1.5 pl-13 text-sm">
          {challenges.length > 0 && <Challenges entry={{ challenges }} nameOf={nameOf} />}
          {entry.note && <NoteText note={entry.note} />}
        </div>
      )}
    </div>
  );
}

function NoteDialog({
  entry,
  pending,
  onClose,
  onSave,
}: {
  entry: DiaryEntry | null;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(entry?.note ?? "");
  const [trackedId, setTrackedId] = useState(entry?.id ?? null);
  if ((entry?.id ?? null) !== trackedId) {
    setTrackedId(entry?.id ?? null);
    setDraft(entry?.note ?? "");
  }
  const unchanged = draft.trim() === (entry?.note ?? "");
  return (
    <Modal
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={entry ? entryName(entry, t) : t("diaryNote")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            loading={pending}
            disabled={pending || unchanged}
            onClick={() => onSave(draft)}
          >
            {t("save")}
          </Button>
        </>
      }
    >
      <label htmlFor="diary-note" className="sr-only">
        {t("diaryNote")}
      </label>
      <Textarea
        id="diary-note"
        value={draft}
        maxLength={NOTE_MAX}
        rows={5}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
      />
    </Modal>
  );
}

/**
 * People destination (#935): the caller's event diary of saved people and
 * sponsor stands, with the opt-in directory (#934) as a secondary view.
 */
export function EventDiary() {
  const { t } = useLocale();
  const { isPureApplicant } = useSessionContext();
  if (isPureApplicant) return <AccessDenied ask={t("diaryAccessDeniedDesc")} />;
  return <DiaryPage />;
}

type DiaryView = "saved" | "directory";

function DiaryPage() {
  const { t } = useLocale();
  const canReadDirectory = useCan(CAPABILITIES.DIRECTORY_READ);
  const views = useMemo<DiaryView[]>(
    () => (canReadDirectory ? ["saved", "directory"] : ["saved"]),
    [canReadDirectory],
  );
  const { tab, setTab } = useUrlTab<DiaryView>({ values: views, defaultValue: "saved" });
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
  const [noteEntry, setNoteEntry] = useState<DiaryEntry | null>(null);
  const [removeEntry, setRemoveEntry] = useState<DiaryEntry | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);

  const replaceEntry = useCallback((next: DiaryEntry) => {
    setEntries((current) =>
      sortEntries([...(current ?? []).filter((entry) => entry.id !== next.id), next]),
    );
  }, []);

  const handlers = useMemo<RowHandlers>(
    () => ({
      busyId,
      onToggleStar: async (entry) => {
        setBusyId(entry.id);
        try {
          replaceEntry(
            await api.patch<DiaryEntry>(`/api/me/diary/${entry.id}`, { starred: !entry.starred }),
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
      onEditNote: (entry) => setNoteEntry(entry),
      onRemove: (entry) => setRemoveEntry(entry),
    }),
    [busyId, replaceEntry, t],
  );

  async function saveNote(note: string) {
    if (!noteEntry) return;
    setBusyId(noteEntry.id);
    try {
      replaceEntry(await api.patch<DiaryEntry>(`/api/me/diary/${noteEntry.id}`, { note }));
      setNoteEntry(null);
      toast.success(t("diaryNoteSaved"), { compactTitle: t("diaryNote") });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("diaryCouldNotSave"), t("diaryNote"));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove() {
    if (!removeEntry) return;
    const entry = removeEntry;
    setBusyId(entry.id);
    try {
      await api.delete(`/api/me/diary/${entry.id}`);
      setEntries((current) => (current ?? []).filter((item) => item.id !== entry.id));
      setRemoveEntry(null);
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

  const savedUserIds = useMemo(
    () =>
      new Set(
        (entries ?? []).flatMap((entry) => (entry.person ? [entry.person.userId] : [])),
      ) as ReadonlySet<number>,
    [entries],
  );
  const save = useMemo<DirectorySaveAction>(
    () => ({
      savedUserIds,
      pendingUserId: savingUserId,
      onSave: async (person) => {
        setSavingUserId(person.userId);
        try {
          replaceEntry(
            await api.post<DiaryEntry>("/api/me/diary/people", { userId: person.userId }),
          );
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : t("diaryCouldNotSave"),
            t("diarySave"),
          );
        } finally {
          setSavingUserId(null);
        }
      },
    }),
    [savedUserIds, savingUserId, replaceEntry, t],
  );

  const columns = useMemo(() => buildColumns(t, nameOf, handlers), [t, nameOf, handlers]);

  const saved = (
    <DataTable
      columns={columns}
      data={entries ?? []}
      getRowId={(entry) => String(entry.id)}
      getRowLabel={(entry) => entryName(entry, t)}
      rowActions={(entry) => <RowMenu entry={entry} handlers={handlers} t={t} />}
      renderMobileRow={(entry) => (
        <DiaryMobileRow entry={entry} t={t} nameOf={nameOf} handlers={handlers} />
      )}
      loading={entries === null && !loadError}
      error={
        loadError
          ? { message: loadError, onRetry: () => setRetryNonce((value) => value + 1) }
          : undefined
      }
      empty={{ icon: AddressBookIcon, title: t("diaryEmpty") }}
    />
  );

  return (
    <PageLayout>
      <PageHeader title={t("diary")} />
      {views.length > 1 ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabBar width="content" aria-label={t("diary")}>
            <TabsTrigger value="saved">{t("diarySavedTab")}</TabsTrigger>
            <TabsTrigger value="directory">{t("diaryDirectoryTab")}</TabsTrigger>
          </TabBar>
          <TabsContent value="saved" className="pt-2">
            {saved}
          </TabsContent>
          <TabsContent value="directory" className="pt-2">
            <PeopleDirectory save={save} />
          </TabsContent>
        </Tabs>
      ) : (
        saved
      )}
      <NoteDialog
        entry={noteEntry}
        pending={noteEntry !== null && busyId === noteEntry.id}
        onClose={() => setNoteEntry(null)}
        onSave={saveNote}
      />
      <AlertModal
        open={removeEntry !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveEntry(null);
        }}
        title={t("diaryRemoveTitle")}
        description={removeEntry ? entryName(removeEntry, t) : ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={removeEntry !== null && busyId === removeEntry.id}
        onConfirm={confirmRemove}
      />
    </PageLayout>
  );
}
