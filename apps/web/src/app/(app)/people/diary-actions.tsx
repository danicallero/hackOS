"use client";

import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import { useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { type Translate, useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Public sponsor card (`SponsorCard`, #935). */
export interface SponsorCard {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  description: string | null;
  website: string | null;
  challenges: { id: number; name: string }[];
}

/**
 * The owner's own choices on a saved person or stand (#935). Saving puts it in
 * the diary; `starred` only marks a saved entry and never adds or removes it.
 */
export interface DiaryMark {
  id: number;
  starred: boolean;
  note: string | null;
}

export interface DiaryHandlers {
  busyId: number | null;
  onToggleStar: (mark: DiaryMark) => void;
  onEditNote: (mark: DiaryMark, title: string) => void;
  onRemove: (mark: DiaryMark, title: string) => void;
}

export const NOTE_MAX = 500;

/** Favourite toggle; only rendered for an entry that is already saved. */
export function StarButton({
  mark,
  name,
  handlers,
  t,
}: {
  mark: DiaryMark;
  name: string;
  handlers: DiaryHandlers;
  t: Translate;
}) {
  return (
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={`${t("diaryFavourite")}: ${name}`}
      aria-pressed={mark.starred}
      disabled={handlers.busyId === mark.id}
      onClick={() => handlers.onToggleStar(mark)}
    >
      <StarIcon
        aria-hidden="true"
        weight={mark.starred ? "fill" : "regular"}
        className={cn("size-4", mark.starred ? "text-warning" : "text-muted-foreground")}
      />
    </IconButton>
  );
}

/** Overflow menu of a saved entry: its private note and the explicit removal. */
export function DiaryMenu({
  mark,
  name,
  handlers,
  t,
}: {
  mark: DiaryMark;
  name: string;
  handlers: DiaryHandlers;
  t: Translate;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={`${t("openMenuAria")}: ${name}`}
          disabled={handlers.busyId === mark.id}
        >
          <DotsThreeIcon aria-hidden="true" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => handlers.onEditNote(mark, name)}>
          {mark.note ? t("diaryEditNote") : t("diaryAddNote")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => handlers.onRemove(mark, name)}>
          {t("diaryRemoveTitle")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Trailing actions of a saved person row (#935): Favourite and the overflow
 * menu. Clicks never reach the row link underneath, including those from the
 * menu, whose portal still bubbles through this React subtree.
 */
export function PersonActions({
  name,
  mark,
  handlers,
}: {
  name: string;
  mark: DiaryMark;
  handlers: DiaryHandlers;
}) {
  const { t } = useLocale();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: only stops clicks from activating the row; the controls inside are buttons.
    <div
      className="flex items-center justify-end gap-0.5"
      onClick={(event) => event.stopPropagation()}
    >
      <StarButton mark={mark} name={name} handlers={handlers} t={t} />
      <DiaryMenu mark={mark} name={name} handlers={handlers} t={t} />
    </div>
  );
}

/** A favourites-only toggle for the toolbar of People and Companies. */
export function FavouritesToggle({
  pressed,
  onPressedChange,
  compact,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      size={compact ? "icon" : "default"}
      aria-pressed={pressed}
      aria-label={t("diaryFavourites")}
      onClick={() => onPressedChange(!pressed)}
    >
      <StarIcon
        aria-hidden="true"
        weight={pressed ? "fill" : "regular"}
        className={cn("size-4", pressed && "text-warning")}
      />
      {!compact && t("diaryFavourites")}
    </Button>
  );
}

export function NoteDialog({
  target,
  pending,
  onClose,
  onSave,
}: {
  target: (DiaryMark & { title: string }) | null;
  pending: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(target?.note ?? "");
  const [trackedId, setTrackedId] = useState(target?.id ?? null);
  if ((target?.id ?? null) !== trackedId) {
    setTrackedId(target?.id ?? null);
    setDraft(target?.note ?? "");
  }
  const unchanged = draft.trim() === (target?.note ?? "");
  return (
    <Modal
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={target?.title ?? t("diaryNote")}
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
