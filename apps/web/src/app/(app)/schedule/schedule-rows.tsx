"use client";

import { useDroppable } from "@dnd-kit/core";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type DayGroup, type ScheduleDraft, scheduleTimeOfDay } from "./schedule-model";

// The row-level pieces of the Manage Schedule table (H59): the day heading, the
// "+" that inserts a row between two others, the draft row it opens, the
// new-date strip, and the activity row itself — which wires each column to its
// editor in schedule-cells.tsx. Extracted from page.tsx, which the page-size
// ratchet keeps to the page itself.

export function DayGroupHeaderRow({
  group,
  colSpan,
  droppable,
}: {
  group: DayGroup;
  colSpan: number;
  droppable: boolean;
}) {
  const { t } = useLocale();
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${group.label}`,
    disabled: !droppable,
    data: { date: group.date },
  });
  return (
    <TableRow
      ref={droppable ? setNodeRef : undefined}
      className={cn("hover:bg-transparent", isOver && "ring-primary/40 ring-2")}
      title={droppable ? t("dropOnDayHint", { day: group.label }) : undefined}
    >
      <TableCell
        colSpan={colSpan}
        className="bg-muted/50 text-muted-foreground py-1.5 text-xs font-medium"
      >
        {group.label}
      </TableCell>
    </TableRow>
  );
}

/**
 * Always-present drop target below the table for moving an item to a day with
 * no items yet — and, on a double click, the way to start that day from
 * nothing: it turns into a date field, and picking a date opens a draft row
 * under a fresh day heading (H59).
 */
export function NewDayDropzoneRow({
  colSpan,
  open,
  onOpen,
  onCancel,
  onPickDate,
}: {
  colSpan: number;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onPickDate: (dayKey: string) => void;
}) {
  const { t } = useLocale();
  const { setNodeRef, isOver } = useDroppable({ id: "new-day-dropzone" });
  const [date, setDate] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setDate(""); // Clear date input when new-day popover closes.
  }, [open]);

  if (open) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan} className="border-t border-dashed py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="sm"
              autoFocus
              type="date"
              value={date}
              aria-label={t("newDayDateLabel")}
              className="w-auto"
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && date) {
                  e.preventDefault();
                  onPickDate(date);
                }
                if (e.key === "Escape") onCancel();
              }}
            />
            <Button size="sm" disabled={!date} onClick={() => date && onPickDate(date)}>
              {t("addAction")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow ref={setNodeRef} className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className={cn(
          "text-muted-foreground border-t border-dashed py-2 text-center text-xs",
          isOver && "bg-muted/50 text-foreground",
        )}
        // Double-clicking the strip opens the date field; the button beside
        // the label is the same action for keyboards and for anyone who
        // doesn't think to try a double click.
        onDoubleClick={onOpen}
      >
        <span className="inline-flex flex-wrap items-center justify-center gap-2">
          {t("dropNewDayLabel")}
          <Button variant="ghost" size="sm" onClick={onOpen}>
            <PlusIcon className="size-3" />
            {t("newDateAction")}
          </Button>
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * The hairline between two rows, which reveals a "+" on hover and inserts a
 * draft row exactly there (H59). Where the row lands is the whole input: the
 * slot decides its start and end, so the draft only has to ask for a title.
 */
export function InsertRowDivider({ colSpan, onInsert }: { colSpan: number; onInsert: () => void }) {
  const { t } = useLocale();
  return (
    <TableRow className="group/insert border-0 hover:bg-transparent">
      <TableCell colSpan={colSpan} className="relative h-2 border-0 p-0">
        <button
          type="button"
          onClick={onInsert}
          aria-label={t("insertActivityHere")}
          title={t("insertActivityHere")}
          className="absolute inset-x-0 top-1/2 flex h-[var(--control-height-tiny)] -translate-y-1/2 cursor-pointer items-center gap-1 px-3 opacity-0 transition-opacity group-hover/insert:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        >
          <span className="bg-primary text-primary-foreground flex size-[var(--control-height-tiny)] shrink-0 items-center justify-center rounded-full">
            <PlusIcon className="size-3" />
          </span>
          <span className="bg-primary/40 h-px flex-1" />
        </button>
      </TableCell>
    </TableRow>
  );
}

/**
 * A row that does not exist yet: one title field, and the start/end the slot
 * already implies shown beside it. Enter creates it and the real row takes
 * its place, where every other column is edited inline as usual.
 */
export function DraftActivityRow({
  colSpan,
  draft,
  saving,
  onCancel,
  onCreate,
}: {
  colSpan: number;
  draft: ScheduleDraft;
  saving: boolean;
  onCancel: () => void;
  onCreate: (title: string) => void;
}) {
  const { t, language } = useLocale();
  const [title, setTitle] = useState("");
  const trimmed = title.trim();

  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={colSpan} className="py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            autoFocus
            value={title}
            aria-label={t("newActivityTitleLabel")}
            placeholder={t("newActivityTitlePlaceholder")}
            className="w-full max-w-sm"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed && !saving) {
                e.preventDefault();
                onCreate(trimmed);
              }
              if (e.key === "Escape") onCancel();
            }}
          />
          <span className="text-muted-foreground text-xs tabular-nums">
            {scheduleTimeOfDay(draft.startsAt, language)}–
            {scheduleTimeOfDay(draft.endsAt, language)}
          </span>
          <Button size="sm" disabled={!trimmed || saving} onClick={() => onCreate(trimmed)}>
            {t("addAction")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
