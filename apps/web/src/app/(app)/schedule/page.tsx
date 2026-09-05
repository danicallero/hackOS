"use client";

// Manage Schedule (H48/H59): the full run-of-show, grouped by day — status,
// start, end, duration, location, item, who's responsible, observations —
// for any account holding at least one capability (see
// callerScheduleAudiences / listScheduleForAudiences), with inline edits,
// bulk visibility/scheduling actions, and delete reserved for
// SCHEDULE_MANAGE holders. Replaces the old DataTable-based /schedule editor
// entirely — this table already covers everything that editor did. Column
// visibility/order is user-configurable and persisted both in localStorage
// (instant) and on the account (cross-device) via /api/me/ui-prefs.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { ActivityKind } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { CalendarClockIcon, EyeIcon, EyeOffIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, type ScheduleAudience } from "@/lib/logistics";
import { useCan, useMe } from "@/lib/session";
import { ActivityRow } from "./schedule-activity-row";
import {
  AudienceFilterPopover,
  BulkSchedulePopover,
  KindFilterPopover,
  MoveToDateModal,
} from "./schedule-dialogs";
import {
  cleanScheduleForm,
  EMPTY_SCHEDULE_FORM,
  pendingOwnerToInput,
  ScheduleFormModal,
  scheduleDuplicateForm,
  scheduleItemToForm,
  scheduleItemToTranslations,
} from "./schedule-form-modal";
import {
  type DayGroup,
  draftWindowBetween,
  filterScheduleItems,
  groupByDay,
  type ScheduleDraft,
  scheduleDayKey,
  scheduleDayLabel,
  withDate,
} from "./schedule-model";
import {
  DayGroupHeaderRow,
  DraftActivityRow,
  InsertRowDivider,
  NewDayDropzoneRow,
} from "./schedule-rows";
import {
  COLUMN_LABEL_KEYS,
  ColumnConfigPopover,
  type ColumnId,
  REQUIRED_COLUMNS,
  ResizableHead,
  useScheduleTableConfig,
} from "./schedule-table-config";

// --- Page --------------------------------------------------------------

export default function SchedulePage() {
  const { t, language } = useLocale();
  const me = useMe();
  const canEdit = useCan(CAPABILITIES.SCHEDULE_MANAGE);
  const canView = Boolean(me && me.capabilities.length > 0);

  const [items, setItems] = useState<PublicScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PublicScheduleItem | null>(null);
  const [duplicatingItem, setDuplicatingItem] = useState<PublicScheduleItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<PublicScheduleItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [tableConfig, setTableConfig] = useScheduleTableConfig();
  const [audienceFilter, setAudienceFilter] = useState<Set<ScheduleAudience>>(new Set());
  const [staffOnlyFilter, setStaffOnlyFilter] = useState(false);
  const [kindFilter, setKindFilter] = useState<Set<ActivityKind>>(new Set());
  const [liveWidths, setLiveWidths] = useState<Partial<Record<ColumnId, number>>>({});
  const columnWidths = useMemo(
    () => ({ ...tableConfig.widths, ...liveWidths }),
    [tableConfig.widths, liveWidths],
  );
  const rowDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleColumnResize = useCallback((id: ColumnId, width: number) => {
    setLiveWidths((prev) => ({ ...prev, [id]: width }));
  }, []);

  const handleColumnResizeEnd = useCallback(
    (id: ColumnId, width: number) => {
      setTableConfig({ ...tableConfig, widths: { ...tableConfig.widths, [id]: width } });
      setLiveWidths((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
    },
    [tableConfig, setTableConfig],
  );

  const load = useCallback(() => {
    setError(null);
    // SCHEDULE_MANAGE holders manage the whole run-of-show including hidden
    // drafts, so they need the unfiltered /api/schedule listing; everyone
    // else only ever sees the live, audience-filtered feed (H59).
    const request = canEdit ? logisticsApi.schedule() : logisticsApi.publicSchedule();
    request
      .then((r) => {
        setItems(r.items);
        setSelectedIds(new Set());
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t("couldNotLoadSchedule"));
      });
  }, [t, canEdit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canView) load(); // Data fetch when capability becomes available; load() callback is stable.
  }, [canView, load]);

  const updateItem = useCallback((id: number, patch: Partial<PublicScheduleItem>) => {
    setItems((prev) => prev?.map((it) => (it.id === id ? { ...it, ...patch } : it)) ?? prev);
  }, []);

  const [moveToDateItem, setMoveToDateItem] = useState<PublicScheduleItem | null>(null);

  // Shifts an item's startsAt/endsAt to a new calendar date, keeping the
  // item's own duration and time-of-day (H59 drag-to-reschedule). Both ends
  // must move together in one PATCH — the API's window check compares
  // whichever one isn't sent against the *current* value, so sending only
  // startsAt would spuriously fail once its shifted date lands after the
  // still-old endsAt.
  const moveItemToDate = useCallback(
    async (item: PublicScheduleItem, targetDate: string) => {
      const nextStartsAt = withDate(item.startsAt, targetDate);
      const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
      const nextEndsAt =
        nextStartsAt && Number.isFinite(durationMs)
          ? new Date(new Date(nextStartsAt).getTime() + durationMs).toISOString()
          : null;
      if (!nextStartsAt || !nextEndsAt) return;
      if (nextStartsAt === item.startsAt && nextEndsAt === item.endsAt) return;
      try {
        const updated = await logisticsApi.updateSchedule(item.id, {
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
        });
        updateItem(item.id, updated);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotMoveScheduleItem"));
      }
    },
    [t, updateItem],
  );

  function onRowDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !items) return;
    const itemId = Number(String(active.id).replace(/^item-/, ""));
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const overId = String(over.id);
    if (overId === "new-day-dropzone") {
      setMoveToDateItem(item);
      return;
    }
    const targetDate = (over.data.current as { date?: string } | undefined)?.date;
    if (targetDate) void moveItemToDate(item, targetDate);
  }

  const filtered = useMemo(
    () =>
      items
        ? filterScheduleItems(items, { query, audienceFilter, staffOnlyFilter, kindFilter })
        : [],
    [items, query, audienceFilter, staffOnlyFilter, kindFilter],
  );

  const groups = useMemo(() => groupByDay(filtered, language), [filtered, language]);
  const visibleColumns = tableConfig.order.filter(
    (id) => REQUIRED_COLUMNS.includes(id) || !tableConfig.hidden.includes(id),
  );

  // The row being typed into the table but not created yet (H59 inline row
  // creation). `index` is the slot *between* rows it was inserted at, so the
  // draft renders exactly where the "+" was clicked; a day key with no group
  // yet is a brand-new date section.
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [newDayOpen, setNewDayOpen] = useState(false);
  const draftIsNewDay = draft !== null && !groups.some((group) => group.date === draft.dayKey);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setState setters are stable and unnecessary for biome, but the React Compiler wants them listed to preserve this useCallback's memoization.
  const openDraft = useCallback(
    (group: DayGroup, index: number) => {
      const previous = index > 0 ? group.items[index - 1] : null;
      const next = index < group.items.length ? group.items[index] : null;
      const window = draftWindowBetween(
        previous?.endsAt ?? null,
        next?.startsAt ?? null,
        group.date,
      );
      if (!window) return;
      setNewDayOpen(false);
      setDraft({ dayKey: group.date, index, ...window });
    },
    [setNewDayOpen, setDraft],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: setState setters are stable and unnecessary for biome, but the React Compiler wants them listed to preserve this useCallback's memoization.
  const openDraftOnNewDay = useCallback(
    (dayKey: string) => {
      const window = draftWindowBetween(null, null, dayKey);
      if (!window) return;
      setNewDayOpen(false);
      setDraft({ dayKey, index: 0, ...window });
    },
    [setNewDayOpen, setDraft],
  );

  // Creates from the draft row with nothing but a title: the slot it was
  // inserted at already decided when it happens, and every other field is
  // editable in the row itself once it exists (the full editor stays one
  // click away in the row's actions).
  // biome-ignore lint/correctness/useExhaustiveDependencies: setState setters are stable and unnecessary for biome, but the React Compiler wants them listed to preserve this useCallback's memoization.
  const createDraft = useCallback(
    async (title: string) => {
      if (!draft) return;
      setBusy(true);
      try {
        await logisticsApi.createSchedule(
          cleanScheduleForm({
            ...EMPTY_SCHEDULE_FORM,
            title,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
          }),
        );
        toast.success(t("scheduleItemCreated"));
        setDraft(null);
        load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      } finally {
        setBusy(false);
      }
    },
    [draft, load, t, setDraft, setBusy],
  );

  /** Either the draft row itself, when it was inserted here, or the "+" that opens it. */
  function renderInsertSlot(group: DayGroup, index: number) {
    if (draft && !draftIsNewDay && draft.dayKey === group.date && draft.index === index) {
      return (
        <DraftActivityRow
          colSpan={visibleColumns.length + 2}
          draft={draft}
          saving={busy}
          onCancel={() => setDraft(null)}
          onCreate={createDraft}
        />
      );
    }
    return (
      <InsertRowDivider
        colSpan={visibleColumns.length + 2}
        onInsert={() => openDraft(group, index)}
      />
    );
  }

  async function remove(item: PublicScheduleItem) {
    setBusy(true);
    try {
      await logisticsApi.deleteSchedule(item.id);
      toast.success(t("scheduleItemDeleted"));
      setDeletingItem(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteScheduleItem"));
    } finally {
      setBusy(false);
    }
  }

  async function bulkVisibility(visibility: "shown" | "hidden") {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      await logisticsApi.setScheduleVisibility([...selectedIds], visibility);
      toast.success(visibility === "shown" ? t("itemsShown") : t("itemsHidden"));
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateVisibility"));
    } finally {
      setBusy(false);
    }
  }

  async function bulkSchedule(publishAt: string | null) {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      await logisticsApi.setScheduleBulkPublishAt([...selectedIds], publishAt);
      toast.success(t("bulkScheduleSet"));
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateVisibility"));
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <AccessDenied ask={t("manageSchedule")} />;

  const allSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  return (
    <div className="space-y-6" data-wide>
      <PageHeader title={t("manageSchedule")} />

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative w-full max-w-xs">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchSchedulePlaceholder")}
              className="pl-9"
              aria-label={t("searchSchedulePlaceholder")}
            />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && selectedIds.size > 0 && (
              <>
                <span className="text-muted-foreground text-sm">
                  {t("selectedCount", { count: selectedIds.size })}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => bulkVisibility("shown")}
                >
                  <EyeIcon className="size-4" />
                  {t("show")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => bulkVisibility("hidden")}
                >
                  <EyeOffIcon className="size-4" />
                  {t("hide")}
                </Button>
                <BulkSchedulePopover disabled={busy} onApply={bulkSchedule} />
              </>
            )}
            {canEdit && (
              <AudienceFilterPopover
                selected={audienceFilter}
                staffOnly={staffOnlyFilter}
                onChange={(selected, staffOnly) => {
                  setAudienceFilter(selected);
                  setStaffOnlyFilter(staffOnly);
                }}
              />
            )}
            {canEdit && <KindFilterPopover selected={kindFilter} onChange={setKindFilter} />}
            <ColumnConfigPopover config={tableConfig} onChange={setTableConfig} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <DndContext
            sensors={rowDragSensors}
            collisionDetection={closestCenter}
            onDragEnd={onRowDragEnd}
          >
            <Table className="table-fixed">
              <colgroup>
                {canEdit && <col style={{ width: 64 }} />}
                {visibleColumns.map((id) => (
                  <col key={id} style={{ width: columnWidths[id] }} />
                ))}
                {canEdit && <col style={{ width: 96 }} />}
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {canEdit && (
                    <TableHead>
                      <Checkbox
                        checked={allSelected}
                        aria-label={t("selectAllAria")}
                        onCheckedChange={(checked) =>
                          setSelectedIds(
                            checked === true ? new Set(filtered.map((i) => i.id)) : new Set(),
                          )
                        }
                      />
                    </TableHead>
                  )}
                  {visibleColumns.map((id) => (
                    <ResizableHead
                      key={id}
                      id={id}
                      width={columnWidths[id]}
                      onResize={handleColumnResize}
                      onResizeEnd={handleColumnResizeEnd}
                    >
                      {t(COLUMN_LABEL_KEYS[id])}
                    </ResizableHead>
                  ))}
                  {canEdit && <TableHead className="text-right">{t("actionsColumn")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={visibleColumns.length + 2} className="p-4">
                      <ContextualError message={error} onRetry={load} />
                    </TableCell>
                  </TableRow>
                ) : items === null ? (
                  Array.from({ length: 6 }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder rows.
                    <TableRow key={i} className="hover:bg-transparent">
                      {Array.from({ length: visibleColumns.length + 2 }, (_, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder cells.
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full max-w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : groups.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={visibleColumns.length + 2} className="p-0">
                      <EmptyState icon={CalendarClockIcon} title={t("noScheduleItemsYet")} />
                    </TableCell>
                  </TableRow>
                ) : (
                  groups.map((group) => (
                    <Fragment key={group.date}>
                      <DayGroupHeaderRow
                        group={group}
                        colSpan={visibleColumns.length + 2}
                        droppable={canEdit}
                      />
                      {canEdit && renderInsertSlot(group, 0)}
                      {group.items.map((item, index) => (
                        <Fragment key={item.id}>
                          <ActivityRow
                            item={item}
                            columns={visibleColumns}
                            canEdit={canEdit}
                            selected={selectedIds.has(item.id)}
                            onToggleSelected={(checked) =>
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              })
                            }
                            onUpdate={(patch) => updateItem(item.id, patch)}
                            onOpenEdit={() => setEditingItem(item)}
                            onDuplicate={() => setDuplicatingItem(item)}
                            onDelete={() => setDeletingItem(item)}
                            dayKey={scheduleDayKey(item.startsAt)}
                          />
                          {canEdit && renderInsertSlot(group, index + 1)}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))
                )}
                {canEdit && draftIsNewDay && draft && (
                  <Fragment key={draft.dayKey}>
                    <DayGroupHeaderRow
                      group={{
                        date: draft.dayKey,
                        label: scheduleDayLabel(draft.startsAt, language),
                        items: [],
                      }}
                      colSpan={visibleColumns.length + 2}
                      droppable={false}
                    />
                    <DraftActivityRow
                      colSpan={visibleColumns.length + 2}
                      draft={draft}
                      saving={busy}
                      onCancel={() => setDraft(null)}
                      onCreate={createDraft}
                    />
                  </Fragment>
                )}
                {canEdit && groups.length > 0 && (
                  <NewDayDropzoneRow
                    colSpan={visibleColumns.length + 2}
                    open={newDayOpen}
                    onOpen={() => {
                      setDraft(null);
                      setNewDayOpen(true);
                    }}
                    onCancel={() => setNewDayOpen(false)}
                    onPickDate={openDraftOnNewDay}
                  />
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>
      </Card>

      <ScheduleFormModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("newScheduleItem")}
        initial={EMPTY_SCHEDULE_FORM}
        onSubmit={async (values, pendingOwners) => {
          const created = await logisticsApi.createSchedule(cleanScheduleForm(values));
          await Promise.all(
            pendingOwners.map((owner) =>
              logisticsApi.addScheduleOwner(created.id, pendingOwnerToInput(owner)),
            ),
          );
          toast.success(t("scheduleItemCreated"));
          setCreateOpen(false);
          load();
          return created;
        }}
      />

      {editingItem && (
        <ScheduleFormModal
          open={Boolean(editingItem)}
          onOpenChange={(open) => {
            if (!open) setEditingItem(null);
          }}
          title={t("editScheduleItem")}
          initial={scheduleItemToForm(editingItem, language)}
          initialTranslations={scheduleItemToTranslations(editingItem, language)}
          scheduleId={editingItem.id}
          onSubmit={async (values) => {
            const updated = await logisticsApi.updateSchedule(
              editingItem.id,
              cleanScheduleForm(values),
            );
            toast.success(t("scheduleItemUpdated"));
            setEditingItem(null);
            // A full edit can move the item to a different day/audience, so
            // a full reload (not a local patch) keeps grouping/filtering correct.
            load();
            return updated;
          }}
        />
      )}

      {duplicatingItem && (
        <ScheduleFormModal
          open={Boolean(duplicatingItem)}
          onOpenChange={(open) => {
            if (!open) setDuplicatingItem(null);
          }}
          title={t("duplicateScheduleItem")}
          initial={scheduleDuplicateForm(duplicatingItem, language)}
          onSubmit={async (values, pendingOwners) => {
            const created = await logisticsApi.createSchedule(cleanScheduleForm(values));
            await Promise.all(
              pendingOwners.map((owner) =>
                logisticsApi.addScheduleOwner(created.id, pendingOwnerToInput(owner)),
              ),
            );
            toast.success(t("scheduleItemDuplicated"));
            setDuplicatingItem(null);
            load();
            return created;
          }}
        />
      )}

      {deletingItem && (
        <AlertModal
          open
          onOpenChange={(open) => {
            if (!open) setDeletingItem(null);
          }}
          title={t("deleteScheduleItemConfirmTitle")}
          description={t("deleteScheduleItemConfirmDesc")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteAction")}
          destructive
          pending={busy}
          onConfirm={() => void remove(deletingItem)}
        />
      )}

      {canEdit && (
        // Zero-height so it never lengthens the page: the button floats over
        // the table's bottom-left corner and stays there while scrolling, so
        // adding an item never means going back up to the header (H59).
        <div className="pointer-events-none sticky bottom-6 z-20 flex h-0 items-end">
          <Button
            className="pointer-events-auto shadow-floating"
            onClick={() => setCreateOpen(true)}
          >
            <PlusIcon className="size-4" />
            {t("newItem")}
          </Button>
        </div>
      )}

      {moveToDateItem && (
        <MoveToDateModal
          item={moveToDateItem}
          onOpenChange={(open) => {
            if (!open) setMoveToDateItem(null);
          }}
          onConfirm={async (targetDateIso) => {
            await moveItemToDate(moveToDateItem, targetDateIso);
            setMoveToDateItem(null);
          }}
        />
      )}
    </div>
  );
}

/** New-date drops use the same date picker as schedule creation (H59). */
