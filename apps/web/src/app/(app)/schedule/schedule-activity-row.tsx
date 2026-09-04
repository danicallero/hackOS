"use client";

// One activity in the Manage Schedule table (H59): the drag handle, the
// selection checkbox, every column wired to its editor in schedule-cells.tsx,
// and the row actions. Its own file because it is far past the ~150-line mark
// the web README puts on a colocated component.

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ACTIVITY_KINDS, isMealActivityKind } from "@hackos/shared/activity-kinds";
import { CopyIcon, GripVerticalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/common/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { formatScheduledDateTime } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, type ScheduleAudience } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import {
  audienceSummary,
  EditableAudienceCell,
  EditableOwnersCell,
  EditablePublishDateCell,
  EditableScannableCell,
  EditableSelectCell,
  EditableStatusCell,
  EditableTextCell,
  EditableTimeCell,
  StatusPill,
} from "./schedule-cells";
import { handleScheduleGridKeyDown } from "./schedule-grid";
import {
  MAX_INLINE_ROLLED_HOURS,
  ownerNames,
  scheduleDuration,
  scheduleStatus,
  scheduleTimeOfDay,
  scheduleTypeLabel,
  timeInputValue,
  withTimeOfDayAcrossMidnight,
} from "./schedule-model";
import {
  ACTIONS_COLUMN,
  type ColumnId,
  isKeyboardColumn,
  SELECT_COLUMN,
} from "./schedule-table-config";

// The row-level pieces of the Manage Schedule table (H59): the day heading, the
// "+" that inserts a row between two others, the draft row it opens, the
// new-date strip, and the activity row itself — which wires each column to its
// editor in schedule-cells.tsx. Extracted from page.tsx, which the page-size
// ratchet keeps to the page itself.

export function ActivityRow({
  item,
  dayKey,
  columns,
  canEdit,
  selected,
  onToggleSelected,
  onUpdate,
  onOpenEdit,
  onDuplicate,
  onDelete,
}: {
  item: PublicScheduleItem;
  dayKey: string;
  columns: ColumnId[];
  canEdit: boolean;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onUpdate: (patch: Partial<PublicScheduleItem>) => void;
  onOpenEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t, language } = useLocale();

  async function saveTime(field: "startsAt" | "endsAt", hhmm: string): Promise<boolean> {
    // Both ends go up together: an end of 00:00 on a 23:00 item means midnight
    // *tonight*, so the counterpart may have rolled a day (H59).
    const next = withTimeOfDayAcrossMidnight(item.startsAt, item.endsAt, field, hhmm);
    if (!next.ok) {
      if (next.reason === "rolledWindowTooLong") {
        toast.error(t("inlineTimeRollTooLong", { hours: MAX_INLINE_ROLLED_HOURS }));
        return false;
      }
      return true;
    }
    if (next.startsAt === item.startsAt && next.endsAt === item.endsAt) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, {
        startsAt: next.startsAt,
        endsAt: next.endsAt,
      });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveLocation(next: string): Promise<boolean> {
    const trimmed = next.trim();
    if (trimmed === (item.location ?? "")) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { location: trimmed || null });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveNotes(next: string): Promise<boolean> {
    const trimmed = next.trim();
    if (trimmed === (item.notes ?? "")) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { notes: trimmed || null });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveType(next: string | null): Promise<boolean> {
    if (next === (item.type ?? null)) return true;
    if (isMealActivityKind(next) && !(item.audiences ?? []).includes("participant")) {
      toast.error(t("mealNeedsParticipantAudience"));
      return false;
    }
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { type: next });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveAudiences(next: ScheduleAudience[]): Promise<boolean> {
    if (isMealActivityKind(item.type) && !next.includes("participant")) {
      toast.error(t("mealNeedsParticipantAudience"));
      return false;
    }
    const requiresScan = next.includes("participant") ? item.requiresScan === true : false;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, {
        audiences: next,
        requiresScan,
      });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveScannable(next: boolean): Promise<boolean> {
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { requiresScan: next });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function saveVisibility(next: "shown" | "hidden"): Promise<boolean> {
    if (next === (item.visibility ?? "hidden")) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { visibility: next });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  async function savePublishAt(next: string | null): Promise<boolean> {
    if (next === item.publishAt) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { publishAt: next });
      onUpdate(updated);
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    }
  }

  const status = scheduleStatus(item);
  // A staff-only item has no audience waiting to be revealed, and an item
  // that's already shown has nothing left to schedule — in both cases
  // publish_at is meaningless (the API forces it back to null for the first),
  // so the cell reads instead of edits (H59).
  const isStaffOnly = (item.audiences ?? []).length === 0;
  const publishAtDisabledHint = isStaffOnly
    ? t("publishDateStaffOnlyHint")
    : item.visibility === "shown"
      ? t("publishDateAlreadyShownHint")
      : undefined;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `item-${item.id}`,
    disabled: !canEdit,
  });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: `row-drop-${item.id}`,
    disabled: !canEdit,
    data: { date: dayKey },
  });

  const setRowNodeRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      setNodeRef(node);
      setDropNodeRef(node);
    },
    [setNodeRef, setDropNodeRef],
  );

  function renderCell(id: ColumnId) {
    switch (id) {
      case "status":
        return canEdit ? (
          <EditableStatusCell
            item={item}
            status={status}
            // Staff-only items are shown to staff unconditionally and the API
            // rejects 'shown' on them (0720) — nothing to toggle (H59).
            disabled={isStaffOnly}
            disabledHint={isStaffOnly ? t("staffSeeAllHint") : undefined}
            fieldLabel={t("statusColumn")}
            onSave={saveVisibility}
          />
        ) : (
          <StatusPill item={item} status={status} />
        );
      case "starts":
        return canEdit ? (
          <EditableTimeCell
            value={timeInputValue(item.startsAt)}
            onSave={(v) => saveTime("startsAt", v)}
          />
        ) : (
          scheduleTimeOfDay(item.startsAt, language)
        );
      case "ends":
        return canEdit ? (
          <EditableTimeCell
            value={timeInputValue(item.endsAt)}
            onSave={(v) => saveTime("endsAt", v)}
          />
        ) : (
          scheduleTimeOfDay(item.endsAt, language)
        );
      case "duration":
        return scheduleDuration(item.startsAt, item.endsAt);
      case "type":
        return canEdit ? (
          <EditableSelectCell
            value={item.type}
            options={[...ACTIVITY_KINDS]}
            labelForOption={(value) => scheduleTypeLabel(value, t)}
            emptyLabel={t("noTypeOption")}
            fieldLabel={t("scheduleKindColumn")}
            onSave={saveType}
          />
        ) : item.type ? (
          scheduleTypeLabel(item.type, t)
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      case "audience":
        return canEdit ? (
          <EditableAudienceCell
            audiences={item.audiences ?? []}
            fieldLabel={t("scheduleAudienceColumn")}
            onSave={saveAudiences}
          />
        ) : (
          audienceSummary(item.audiences ?? [], t)
        );
      case "scannable":
        return canEdit ? (
          <EditableScannableCell
            checked={item.requiresScan === true}
            disabled={
              isMealActivityKind(item.type) || !(item.audiences ?? []).includes("participant")
            }
            disabledHint={
              isMealActivityKind(item.type)
                ? t("mealsAlwaysRegistrable")
                : !(item.audiences ?? []).includes("participant")
                  ? t("scannableRequiresParticipant")
                  : undefined
            }
            fieldLabel={t("scheduleScannableColumn")}
            onSave={saveScannable}
          />
        ) : item.requiresScan ? (
          t("yesLabel")
        ) : (
          t("noLabel")
        );
      case "publishAt":
        return canEdit && !publishAtDisabledHint ? (
          <EditablePublishDateCell
            value={item.publishAt}
            locale={language}
            fieldLabel={t("schedulePublishDateColumn")}
            onSave={savePublishAt}
          />
        ) : canEdit ? (
          <span
            className="text-muted-foreground block truncate px-1 py-0.5"
            title={publishAtDisabledHint}
          >
            —
          </span>
        ) : item.publishAt ? (
          formatScheduledDateTime(item.publishAt, language)
        ) : (
          t("notSet")
        );
      case "location":
        return canEdit ? (
          <EditableTextCell
            value={item.location ?? ""}
            placeholder={t("locationLabel")}
            onSave={saveLocation}
          />
        ) : (
          (item.location ?? <span className="text-muted-foreground">—</span>)
        );
      case "item":
        return (
          <button
            type="button"
            onClick={canEdit ? onOpenEdit : undefined}
            disabled={!canEdit}
            className={
              canEdit
                ? "hover:bg-muted -mx-1 w-full rounded px-1 py-0.5 text-left disabled:cursor-default"
                : "-mx-1 w-full px-1 py-0.5 text-left"
            }
            aria-label={canEdit ? t("editItemAria") : undefined}
          >
            <p className="truncate font-medium">{item.title}</p>
            {item.description && (
              <p className="text-muted-foreground line-clamp-1 text-sm">{item.description}</p>
            )}
          </button>
        );
      case "owners":
        return canEdit ? (
          <EditableOwnersCell item={item} onUpdate={onUpdate} />
        ) : (
          ownerNames(item) || <span className="text-muted-foreground">—</span>
        );
      case "notes":
        return canEdit ? (
          <EditableTextCell value={item.notes ?? ""} onSave={saveNotes} />
        ) : (
          (item.notes ?? <span className="text-muted-foreground">—</span>)
        );
      default:
        return null;
    }
  }

  return (
    <TableRow
      ref={setRowNodeRef}
      data-state={selected ? "selected" : undefined}
      style={
        transform
          ? {
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
              position: "relative",
            }
          : undefined
      }
      className={cn(
        isDragging && "z-10 opacity-60 shadow-lg",
        isOver && !isDragging && "bg-muted/50",
      )}
    >
      {canEdit && (
        // The selection checkbox is a grid cell like any other, so arrow keys
        // reach it — selecting rows for the bulk actions shouldn't need a
        // mouse (H59). The drag handle stays out: reordering has its own
        // keyboard path via the Move-to-date action.
        <TableCell
          data-schedule-cell="true"
          data-schedule-row={item.id}
          data-schedule-column={SELECT_COLUMN}
        >
          <div className="flex items-center gap-0.5">
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("dragItemAria")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 shrink-0 cursor-grab touch-none active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-4" aria-hidden="true" />
            </IconButton>
            <Checkbox
              checked={selected}
              aria-label={t("selectRowAria")}
              onKeyDown={handleScheduleGridKeyDown}
              data-schedule-focusable="true"
              onCheckedChange={(checked) => onToggleSelected(checked === true)}
            />
          </div>
        </TableCell>
      )}
      {columns.map((id) => (
        <TableCell
          key={id}
          className="relative"
          data-schedule-cell={canEdit && isKeyboardColumn(id) ? "true" : undefined}
          data-schedule-row={canEdit && isKeyboardColumn(id) ? item.id : undefined}
          data-schedule-column={canEdit && isKeyboardColumn(id) ? id : undefined}
        >
          {renderCell(id)}
        </TableCell>
      ))}
      {canEdit && (
        // Also a grid cell, so ArrowRight off the last column lands on the row
        // actions instead of dead-ending; Tab from there walks the three
        // buttons natively, which is why this one trigger doesn't take Tab.
        <TableCell
          className="text-right"
          data-schedule-cell="true"
          data-schedule-row={item.id}
          data-schedule-column={ACTIONS_COLUMN}
        >
          <div className="flex justify-end gap-0.5">
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("editItemAria")}
              data-schedule-focusable="true"
              onKeyDown={(event) => {
                if (event.key === "Tab") return;
                handleScheduleGridKeyDown(event);
              }}
              onClick={onOpenEdit}
            >
              <PencilIcon className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton variant="ghost" size="icon-sm" label={t("duplicate")} onClick={onDuplicate}>
              <CopyIcon className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={t("deleteItemAria")}
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2Icon className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * A staff-only item has no visibility to report — staff sees it, nobody else
 * does, and that's already spelled out in the Audience column — so the status
 * column stays empty for it rather than repeating "Staff only" on every row.
 */
