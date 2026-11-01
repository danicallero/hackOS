"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey";
import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { type DiaryMark, FavouritesToggle, NoteDialog, type SponsorCard } from "./diary-actions";
import { type ChallengeName, Challenges } from "./person-row";

/** One company of `GET /api/me/diary/sponsors` (#935). */
export interface CollectionItem extends SponsorCard {
  entry: (DiaryMark & { createdAt: string }) | null;
}

export interface SponsorCollection {
  total: number;
  collected: number;
  items: CollectionItem[];
}

/** Collected first, newest first; then the rest by name (the API order). */
function sortItems(items: CollectionItem[]): CollectionItem[] {
  return [...items].sort((a, b) => {
    if (a.entry && b.entry) return b.entry.createdAt.localeCompare(a.entry.createdAt);
    if (a.entry || b.entry) return a.entry ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function withCounts(items: CollectionItem[]): SponsorCollection {
  return {
    total: items.length,
    collected: items.filter((item) => item.entry !== null).length,
    items,
  };
}

function ProgressRing({ collected, total }: { collected: number; total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const ratio = total === 0 ? 0 : collected / total;
  return (
    <div className="relative size-16 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-border" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
            ratio === 1 ? "stroke-success" : "stroke-primary",
          )}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        {ratio === 1 ? (
          <TrophyIcon weight="fill" className="text-success size-6" />
        ) : (
          <StorefrontIcon weight="duotone" className="text-primary size-6" />
        )}
      </span>
    </div>
  );
}

/** The round logo badge; locked stands are a muted, dashed silhouette. */
function CompanyBadge({ item, size = "md" }: { item: CollectionItem; size?: "md" | "lg" }) {
  const { t } = useLocale();
  const collected = item.entry !== null;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full",
        size === "lg" ? "size-24" : "size-20 sm:size-24",
        collected
          ? "bg-card shadow-sm ring-1 ring-border"
          : "bg-muted/40 border-2 border-dashed border-border",
      )}
    >
      <span
        className={cn(
          "flex size-full items-center justify-center overflow-hidden rounded-full p-4",
          !collected && "opacity-40 grayscale",
        )}
      >
        {item.logoUrl ? (
          <SponsorLogo
            logoUrl={item.logoUrl}
            logoNegativeUrl={item.logoNegativeUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-muted-foreground text-lg font-semibold">{initials(item.name)}</span>
        )}
      </span>
      {collected && item.entry?.starred && (
        <span className="bg-background absolute -top-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full shadow-sm ring-1 ring-border">
          <StarIcon
            weight="fill"
            className="text-warning size-3.5"
            aria-label={t("diaryFavourite")}
          />
        </span>
      )}
      {!collected && (
        <span className="bg-background absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full ring-1 ring-border">
          <LockKeyIcon
            className="text-muted-foreground size-3.5"
            aria-label={t("diaryNotCollected")}
          />
        </span>
      )}
    </span>
  );
}

/**
 * Companies (#935): the sponsor stands the attendee collects by scanning them,
 * as an album with progress. Kept apart from People: a stand is a sticker to
 * collect, not a contact.
 */
export function CompanyCollection({ nameOf }: { nameOf: ChallengeName }) {
  const { t, language } = useLocale();
  const isMobile = useIsMobile();
  const [collection, setCollection] = useState<SponsorCollection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [noteTarget, setNoteTarget] = useState<(DiaryMark & { title: string }) | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CollectionItem | null>(null);
  const loaded = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is a ping-only trigger.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .get<SponsorCollection>("/api/me/diary/sponsors")
      .then((r) => {
        if (cancelled) return;
        loaded.current = true;
        setCollection(r);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = apiErrorText(err, t, t("diaryCompaniesCouldNotLoad"));
        if (loaded.current) toast.error(message, t("diaryCompaniesTab"));
        else setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [retryNonce, t]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: "medium" }),
    [language],
  );

  function updateItem(enterpriseId: number, entry: CollectionItem["entry"]) {
    setCollection((current) =>
      current
        ? withCounts(
            sortItems(
              current.items.map((item) =>
                item.enterpriseId === enterpriseId ? { ...item, entry } : item,
              ),
            ),
          )
        : current,
    );
  }

  /** PATCH answers the whole diary entry; only the owner's marks are kept here. */
  async function patchEntry(item: CollectionItem, body: { starred?: boolean; note?: string }) {
    if (!item.entry) return;
    const entry = item.entry;
    setBusyId(entry.id);
    try {
      const next = await api.patch<DiaryMark & { createdAt: string }>(
        `/api/me/diary/${entry.id}`,
        body,
      );
      updateItem(item.enterpriseId, {
        id: entry.id,
        starred: next.starred,
        note: next.note,
        createdAt: entry.createdAt,
      });
      return true;
    } catch (err) {
      toast.error(
        apiErrorText(err, t, t("diaryCouldNotSave")),
        body.note !== undefined ? t("diaryNote") : t("diaryFavourite"),
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote(note: string) {
    const item = collection?.items.find((candidate) => candidate.entry?.id === noteTarget?.id);
    if (!item) return;
    if (await patchEntry(item, { note })) {
      setNoteTarget(null);
      toast.success(t("diaryNoteSaved"), { compactTitle: t("diaryNote") });
    }
  }

  async function confirmRemove() {
    const item = removeTarget;
    if (!item?.entry) return;
    setBusyId(item.entry.id);
    try {
      await api.delete(`/api/me/diary/${item.entry.id}`);
      updateItem(item.enterpriseId, null);
      setRemoveTarget(null);
      toast.success(t("diaryRemoved"), { compactTitle: t("diaryRemoveTitle") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("diaryCouldNotSave")), t("diaryRemoveTitle"));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return (
      <ContextualError message={loadError} onRetry={() => setRetryNonce((value) => value + 1)} />
    );
  }
  if (!collection) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-20 w-full max-w-md rounded-xl" />
        <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => `skeleton-${index}`).map((key) => (
            <div key={key} className="flex flex-col items-center gap-2">
              <Skeleton className="size-20 rounded-full sm:size-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (collection.total === 0) {
    return <EmptyState icon={StorefrontIcon} title={t("diaryCollectionEmpty")} />;
  }

  const complete = collection.collected === collection.total;
  const visible = favouritesOnly
    ? collection.items.filter((item) => item.entry?.starred)
    : collection.items;
  const open = collection.items.find((item) => item.enterpriseId === openId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <ProgressRing collected={collection.collected} total={collection.total} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-2xl font-semibold tabular-nums">
            {t("diaryCollectionCount", {
              collected: collection.collected,
              total: collection.total,
            })}
          </p>
          <p className="text-muted-foreground text-sm text-pretty">
            {complete ? t("diaryCollectionComplete") : t("diaryCollectionHint")}
          </p>
        </div>
        {collection.collected > 0 && (
          <FavouritesToggle
            pressed={favouritesOnly}
            onPressedChange={setFavouritesOnly}
            compact={isMobile}
          />
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={StarIcon} title={t("diaryNoFavourites")} />
      ) : (
        <ul className="grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
          {visible.map((item) => (
            <li key={item.enterpriseId}>
              <button
                type="button"
                onClick={() => setOpenId(item.enterpriseId)}
                aria-label={item.entry ? item.name : `${item.name}: ${t("diaryNotCollected")}`}
                className="hover:bg-muted/60 focus-visible:ring-ring flex w-full flex-col items-center gap-2 rounded-xl px-1 py-3 outline-none transition-colors focus-visible:ring-2 active:bg-muted"
              >
                <CompanyBadge item={item} />
                <span
                  className={cn(
                    "line-clamp-2 text-center text-sm wrap-anywhere",
                    item.entry ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {item.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        title={open?.name ?? ""}
        size="sm"
        footer={
          open?.entry ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <IconButton
                type="button"
                variant="ghost"
                label={t("diaryRemoveTitle")}
                className="text-destructive hover:text-destructive mr-auto"
                disabled={busyId === open.entry.id}
                onClick={() => {
                  setOpenId(null);
                  setRemoveTarget(open);
                }}
              >
                <TrashIcon aria-hidden="true" />
              </IconButton>
              <Button
                type="button"
                variant="outline"
                disabled={busyId === open.entry.id}
                onClick={() => {
                  const entry = open.entry!;
                  setOpenId(null);
                  setNoteTarget({ ...entry, title: open.name });
                }}
              >
                <NotePencilIcon aria-hidden="true" />
                {open.entry.note ? t("diaryEditNote") : t("diaryAddNote")}
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={open.entry.starred}
                disabled={busyId === open.entry.id}
                onClick={() => void patchEntry(open, { starred: !open.entry!.starred })}
              >
                <StarIcon
                  aria-hidden="true"
                  weight={open.entry.starred ? "fill" : "regular"}
                  className={cn(open.entry.starred && "text-warning")}
                />
                {t("diaryFavourite")}
              </Button>
            </div>
          ) : undefined
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <CompanyBadge item={open} size="lg" />
              <div className="min-w-0 space-y-1">
                <p className="text-muted-foreground text-sm">
                  {open.entry
                    ? t("diaryCollectedOn", {
                        date: dateFormat.format(new Date(open.entry.createdAt)),
                      })
                    : t("diaryCollectionHint")}
                </p>
                {open.website && (
                  <a
                    href={open.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1 text-sm underline-offset-4 hover:underline"
                  >
                    <span className="truncate">
                      {open.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </span>
                    <ArrowSquareOutIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="sr-only">{t("diaryOpensInNewTab")}</span>
                  </a>
                )}
              </div>
            </div>
            {open.description && (
              <p className="text-sm whitespace-pre-line wrap-break-word">{open.description}</p>
            )}
            {open.challenges.length > 0 && <Challenges entry={open} nameOf={nameOf} />}
            {open.entry?.note && (
              <p className="bg-muted/60 rounded-lg px-3 py-2 text-sm whitespace-pre-line wrap-break-word italic">
                {open.entry.note}
              </p>
            )}
          </div>
        )}
      </Modal>
      <NoteDialog
        target={noteTarget}
        pending={noteTarget !== null && busyId === noteTarget.id}
        onClose={() => setNoteTarget(null)}
        onSave={(note) => void saveNote(note)}
      />
      <AlertModal
        open={removeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
        title={t("diaryRemoveTitle")}
        description={removeTarget?.name ?? ""}
        cancelLabel={t("cancel")}
        confirmLabel={t("remove")}
        destructive
        pending={removeTarget?.entry != null && busyId === removeTarget.entry.id}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
