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
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  CalendarClockIcon,
  CalendarPlusIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FilterIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatScheduledDateTime, toDatetimeLocal } from "@/lib/datetime";
import { type MessageKey, useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PublicScheduleItem,
  type ScheduleAudience,
  uiPrefsApi,
} from "@/lib/logistics";
import { useCan, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import {
  cleanScheduleForm,
  EMPTY_SCHEDULE_FORM,
  pendingOwnerToInput,
  ScheduleFormModal,
  scheduleDuplicateForm,
  scheduleItemToForm,
} from "./schedule-form-modal";
import {
  SCHEDULE_AUDIENCES,
  SCHEDULE_STATUS_TONES,
  scheduleAudienceLabel,
  scheduleDayKey,
  scheduleDayLabel,
  scheduleDuration,
  scheduleStatus,
  scheduleStatusLabel,
  scheduleTimeOfDay,
  scheduleTypeLabel,
  timeInputValue,
  withDate,
  withTimeOfDay,
} from "./schedule-model";

function ownerDisplayName(owner: {
  name: string | null;
  surname: string | null;
  email?: string;
  freeTextName: string | null;
}): string {
  return (
    owner.freeTextName ??
    ([owner.name, owner.surname].filter(Boolean).join(" ") || owner.email || "")
  );
}

function ownerNames(item: PublicScheduleItem): string {
  return (item.owners ?? []).map(ownerDisplayName).join(", ");
}

interface DayGroup {
  label: string;
  /** Local YYYY-MM-DD key; unlike the label it stays unique across locales. */
  date: string;
  items: PublicScheduleItem[];
}

function groupByDay(items: PublicScheduleItem[], language: Parameters<typeof scheduleDayLabel>[1]) {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const date = scheduleDayKey(item.startsAt);
    const label = scheduleDayLabel(item.startsAt, language);
    const last = groups.at(-1);
    if (last?.date === date) last.items.push(item);
    else groups.push({ label, date, items: [item] });
  }
  return groups;
}

function compareScheduleItems(a: PublicScheduleItem, b: PublicScheduleItem): number {
  const startDelta = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  return startDelta || a.id - b.id;
}

type ScheduleNavigationDirection =
  | "next"
  | "previous"
  | "nextInRow"
  | "previousInRow"
  | "nextInColumn"
  | "previousInColumn";

interface ScheduleCellAddress {
  row: string;
  column: string;
}

function scheduleNavigationDirection(
  event: React.KeyboardEvent<HTMLElement>,
): ScheduleNavigationDirection | null {
  if (event.key === "Tab") return event.shiftKey ? "previous" : "next";
  if (event.key === "ArrowLeft") return "previousInRow";
  if (event.key === "ArrowRight") return "nextInRow";
  if (event.key === "ArrowUp") return "previousInColumn";
  if (event.key === "ArrowDown") return "nextInColumn";
  return null;
}

function scheduleCellAddress(element: HTMLElement): ScheduleCellAddress | null {
  const cell = element.closest<HTMLElement>('[data-schedule-cell="true"]');
  if (!cell?.dataset.scheduleRow || !cell.dataset.scheduleColumn) return null;
  return { row: cell.dataset.scheduleRow, column: cell.dataset.scheduleColumn };
}

function scheduleCellElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-schedule-cell="true"]')).filter(
    (cell) => {
      const target = cell.querySelector<HTMLElement>('[data-schedule-focusable="true"]');
      return target !== null && !target.hasAttribute("disabled");
    },
  );
}

function scheduleCellTarget(address: ScheduleCellAddress): HTMLElement | null {
  const cell = scheduleCellElements().find(
    (candidate) =>
      candidate.dataset.scheduleRow === address.row &&
      candidate.dataset.scheduleColumn === address.column,
  );
  return cell?.querySelector<HTMLElement>('[data-schedule-focusable="true"]') ?? null;
}

function scheduleNavigationTarget(
  element: HTMLElement,
  direction: ScheduleNavigationDirection,
): ScheduleCellAddress | null {
  const current = scheduleCellAddress(element);
  if (!current) return null;

  const cells = scheduleCellElements();
  const currentIndex = cells.findIndex(
    (cell) =>
      cell.dataset.scheduleRow === current.row && cell.dataset.scheduleColumn === current.column,
  );
  if (currentIndex === -1) return null;

  let candidates: HTMLElement[];
  let targetIndex: number;
  if (direction === "next" || direction === "previous") {
    candidates = cells;
    targetIndex = currentIndex + (direction === "next" ? 1 : -1);
  } else if (direction === "nextInRow" || direction === "previousInRow") {
    candidates = cells.filter((cell) => cell.dataset.scheduleRow === current.row);
    const rowIndex = candidates.findIndex((cell) => cell.dataset.scheduleColumn === current.column);
    targetIndex = rowIndex + (direction === "nextInRow" ? 1 : -1);
  } else {
    candidates = cells.filter((cell) => cell.dataset.scheduleColumn === current.column);
    const columnIndex = candidates.findIndex((cell) => cell.dataset.scheduleRow === current.row);
    targetIndex = columnIndex + (direction === "nextInColumn" ? 1 : -1);
  }

  const target = candidates[targetIndex];
  if (!target?.dataset.scheduleRow || !target.dataset.scheduleColumn) return null;
  return { row: target.dataset.scheduleRow, column: target.dataset.scheduleColumn };
}

function focusScheduleCell(address: ScheduleCellAddress, activate = true): void {
  const target = scheduleCellTarget(address);
  if (!target) return;
  target.focus();
  if (activate && target.dataset.scheduleActivate === "true") target.click();
}

function handleScheduleGridKeyDown(event: React.KeyboardEvent<HTMLElement>): boolean {
  const direction = scheduleNavigationDirection(event);
  if (!direction) return false;
  const target = scheduleNavigationTarget(event.currentTarget, direction);
  if (!target) return false;
  event.preventDefault();
  requestAnimationFrame(() => focusScheduleCell(target));
  return true;
}

async function commitAndNavigate(
  event: React.KeyboardEvent<HTMLElement>,
  commit: () => Promise<boolean>,
): Promise<boolean> {
  const direction = scheduleNavigationDirection(event);
  if (!direction) return false;
  const target = scheduleNavigationTarget(event.currentTarget, direction);
  if (!target) return false;
  event.preventDefault();
  if (await commit()) requestAnimationFrame(() => focusScheduleCell(target));
  return true;
}

// --- Column configuration (H59): which columns show, and in what order,
// persisted in localStorage for an instant read and synced to the account
// so it follows the user across devices. -----------------------------------

type ColumnId =
  | "status"
  | "starts"
  | "ends"
  | "duration"
  | "type"
  | "audience"
  | "scannable"
  | "publishAt"
  | "location"
  | "item"
  | "owners"
  | "notes";

const COLUMN_LABEL_KEYS: Record<ColumnId, MessageKey> = {
  status: "statusColumn",
  starts: "colStarts",
  ends: "endsLabel",
  duration: "colDuration",
  type: "scheduleKindColumn",
  audience: "scheduleAudienceColumn",
  scannable: "scheduleScannableColumn",
  publishAt: "schedulePublishDateColumn",
  location: "locationLabel",
  item: "colItem",
  owners: "ownersLabel",
  notes: "notesLabel",
};

/** Default column widths in px — also the resize handle's live-drag unit. */
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  starts: 72,
  ends: 72,
  duration: 64,
  type: 124,
  audience: 150,
  scannable: 96,
  publishAt: 156,
  location: 140,
  item: 320,
  owners: 180,
  notes: 220,
  status: 110,
};

const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 480;

const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  "starts",
  "ends",
  "duration",
  "type",
  "audience",
  "scannable",
  "publishAt",
  "location",
  "item",
  "owners",
  "notes",
  "status",
];

const REQUIRED_COLUMNS: ColumnId[] = ["item"];
const KEYBOARD_COLUMNS: ColumnId[] = [
  "starts",
  "ends",
  "type",
  "audience",
  "scannable",
  "publishAt",
  "location",
  "owners",
  "notes",
];

interface TableConfig {
  order: ColumnId[];
  hidden: ColumnId[];
  widths: Record<ColumnId, number>;
}

const DEFAULT_TABLE_CONFIG: TableConfig = {
  order: DEFAULT_COLUMN_ORDER,
  hidden: [],
  widths: DEFAULT_COLUMN_WIDTHS,
};
const STORAGE_KEY = "hackos:scheduleTable:v4";

function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && value in COLUMN_LABEL_KEYS;
}

function isKeyboardColumn(id: ColumnId): boolean {
  return KEYBOARD_COLUMNS.includes(id);
}

function clampWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function sanitizeWidths(raw: unknown): Record<ColumnId, number> {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const widths = { ...DEFAULT_COLUMN_WIDTHS };
  for (const id of DEFAULT_COLUMN_ORDER) {
    const value = obj[id];
    if (typeof value === "number" && Number.isFinite(value)) widths[id] = clampWidth(value);
  }
  return widths;
}

function sanitizeTableConfig(raw: unknown): TableConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { order?: unknown; hidden?: unknown; widths?: unknown };
  const order = Array.isArray(obj.order) ? obj.order.filter(isColumnId) : [];
  const hidden = Array.isArray(obj.hidden)
    ? obj.hidden.filter((id): id is ColumnId => isColumnId(id) && !REQUIRED_COLUMNS.includes(id))
    : [];
  const merged = [...order, ...DEFAULT_COLUMN_ORDER.filter((id) => !order.includes(id))];
  if (merged.length !== DEFAULT_COLUMN_ORDER.length) return null;
  return { order: merged, hidden, widths: sanitizeWidths(obj.widths) };
}

function loadLocalTableConfig(): TableConfig | null {
  try {
    return sanitizeTableConfig(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

function useScheduleTableConfig(): [TableConfig, (next: TableConfig) => void] {
  const [config, setConfigState] = useState<TableConfig>(
    () => loadLocalTableConfig() ?? DEFAULT_TABLE_CONFIG,
  );

  useEffect(() => {
    uiPrefsApi
      .get()
      .then((prefs) => {
        const remote = sanitizeTableConfig(prefs.scheduleTable);
        if (remote) {
          setConfigState(remote);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
          } catch {
            // localStorage may be unavailable (private browsing); the account copy still applies for this session.
          }
        }
      })
      .catch(() => {
        // Not signed in with the right capability, or offline — the local copy already applied.
      });
  }, []);

  const setConfig = useCallback((next: TableConfig) => {
    setConfigState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort only.
    }
    void uiPrefsApi.set("scheduleTable", next).catch(() => {});
  }, []);

  return [config, setConfig];
}

function ColumnConfigPopover({
  config,
  onChange,
}: {
  config: TableConfig;
  onChange: (next: TableConfig) => void;
}) {
  const { t } = useLocale();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggle(id: ColumnId, visible: boolean) {
    const hidden = visible ? config.hidden.filter((h) => h !== id) : [...config.hidden, id];
    onChange({ ...config, hidden });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = config.order.indexOf(active.id as ColumnId);
    const newIndex = config.order.indexOf(over.id as ColumnId);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange({ ...config, order: arrayMove(config.order, oldIndex, newIndex) });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontalIcon className="size-4" />
          {t("columnsAction")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={config.order} strategy={verticalListSortingStrategy}>
            {config.order.map((id) => {
              const required = REQUIRED_COLUMNS.includes(id);
              const visible = required || !config.hidden.includes(id);
              return (
                <SortableItem key={id} id={id}>
                  {(drag) => (
                    <div className="flex items-center gap-1.5 rounded px-1 py-1">
                      <DragHandle
                        attributes={drag.attributes}
                        listeners={drag.listeners}
                        label={t("reorderColumnAria")}
                      />
                      <Checkbox
                        id={`col-${id}`}
                        checked={visible}
                        disabled={required}
                        onCheckedChange={(checked) => toggle(id, checked === true)}
                      />
                      <label htmlFor={`col-${id}`} className="flex-1 text-sm">
                        {t(COLUMN_LABEL_KEYS[id])}
                      </label>
                    </div>
                  )}
                </SortableItem>
              );
            })}
          </SortableContext>
        </DndContext>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Drag-to-resize a column's header border (H59). Live width updates go
 * straight to the parent's cheap `liveWidths` state (React only, no
 * persistence) on every pointermove; the final width is only persisted
 * (localStorage + account sync) once, on pointerup — the exact final value
 * is computed from the drag's own start point rather than read back from
 * parent state, so there's no stale-closure risk.
 */
function ResizableHead({
  id,
  width,
  onResize,
  onResizeEnd,
  children,
}: {
  id: ColumnId;
  width: number;
  onResize: (id: ColumnId, width: number) => void;
  onResizeEnd: (id: ColumnId, width: number) => void;
  children: React.ReactNode;
}) {
  const { t } = useLocale();

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    const start = { x: e.clientX, width };
    function onMove(ev: PointerEvent) {
      onResize(id, clampWidth(start.width + (ev.clientX - start.x)));
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onResizeEnd(id, clampWidth(start.width + (ev.clientX - start.x)));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Arrow keys resize in 16px steps for keyboard/screen-reader users, since
  // the pointer drag above has no keyboard equivalent on its own.
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResizeEnd(id, clampWidth(width - 16));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onResizeEnd(id, clampWidth(width + 16));
    }
  }

  return (
    <TableHead className="relative overflow-hidden select-none">
      <span className="block truncate pr-2">{children}</span>
      <button
        type="button"
        aria-label={t("resizeColumnAria")}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="hover:bg-primary/50 active:bg-primary/70 absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none focus-visible:bg-primary/60 outline-none"
      />
    </TableHead>
  );
}

/**
 * Filter the visible rows by audience (H59) — sponsor/participant/mentor
 * checkboxes plus a synthetic "staff-only" option for items with no stored
 * audience at all (staff is implicit, never a stored value). Multiple
 * selections combine with OR: an item matches if it has any of the checked
 * audiences, or is staff-only and that option is checked.
 */
function AudienceFilterPopover({
  selected,
  staffOnly,
  onChange,
}: {
  selected: Set<ScheduleAudience>;
  staffOnly: boolean;
  onChange: (selected: Set<ScheduleAudience>, staffOnly: boolean) => void;
}) {
  const { t } = useLocale();
  const activeCount = selected.size + (staffOnly ? 1 : 0);

  function toggleAudience(audience: ScheduleAudience, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(audience);
    else next.delete(audience);
    onChange(next, staffOnly);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon className="size-4" />
          {t("audienceFilterAction")}
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 flex size-4 items-center justify-center rounded-full text-[10px]">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 space-y-1">
        {SCHEDULE_AUDIENCES.map((audience) => (
          <div key={audience} className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              id={`audience-filter-${audience}`}
              checked={selected.has(audience)}
              onCheckedChange={(checked) => toggleAudience(audience, checked === true)}
            />
            <label htmlFor={`audience-filter-${audience}`} className="flex-1 text-sm">
              {scheduleAudienceLabel(audience, t)}
            </label>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 border-t px-1 pt-2">
          <Checkbox
            id="audience-filter-staff-only"
            checked={staffOnly}
            onCheckedChange={(checked) => onChange(selected, checked === true)}
          />
          <label htmlFor="audience-filter-staff-only" className="flex-1 text-sm">
            {t("audienceFilterStaffOnly")}
          </label>
        </div>
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onChange(new Set(), false)}
          >
            {t("clearFilters")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

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
    if (canView) load();
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

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    let list = q
      ? items.filter((item) =>
          `${item.title} ${item.location ?? ""} ${ownerNames(item)}`.toLowerCase().includes(q),
        )
      : items;
    if (audienceFilter.size > 0 || staffOnlyFilter) {
      list = list.filter((item) => {
        const audiences = item.audiences ?? [];
        if (audiences.length === 0) return staffOnlyFilter;
        return audiences.some((a) => audienceFilter.has(a));
      });
    }
    // groupByDay merges same-day items only when they're adjacent in this
    // list — sort chronologically first so every day forms exactly one
    // contiguous (and correctly ordered) group.
    return [...list].sort(compareScheduleItems);
  }, [items, query, audienceFilter, staffOnlyFilter]);

  const groups = useMemo(() => groupByDay(filtered, language), [filtered, language]);
  const visibleColumns = tableConfig.order.filter(
    (id) => REQUIRED_COLUMNS.includes(id) || !tableConfig.hidden.includes(id),
  );

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
      <PageHeader
        title={t("manageSchedule")}
        description={t("manageScheduleDescription")}
        primaryAction={
          canEdit ? (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              {t("newItem")}
            </Button>
          ) : undefined
        }
      />

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
              className="h-9 pl-9"
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
                      {group.items.map((item) => (
                        <ActivityRow
                          key={item.id}
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
                      ))}
                    </Fragment>
                  ))
                )}
                {canEdit && groups.length > 0 && (
                  <NewDayDropzoneRow colSpan={visibleColumns.length + 2} />
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
        }}
      />

      {editingItem && (
        <ScheduleFormModal
          open={Boolean(editingItem)}
          onOpenChange={(open) => {
            if (!open) setEditingItem(null);
          }}
          title={t("editScheduleItem")}
          initial={scheduleItemToForm(editingItem)}
          scheduleId={editingItem.id}
          onSubmit={async (values) => {
            await logisticsApi.updateSchedule(editingItem.id, cleanScheduleForm(values));
            toast.success(t("scheduleItemUpdated"));
            setEditingItem(null);
            // A full edit can move the item to a different day/audience, so
            // a full reload (not a local patch) keeps grouping/filtering correct.
            load();
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
          initial={scheduleDuplicateForm(duplicatingItem)}
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

/**
 * Opens when a row is dropped on the "new date" dropzone (H59 drag-to-
 * reschedule) — day sections aren't stored objects, just a groupBy of
 * startsAt, so "create a new day" just means picking a date nothing is
 * grouped under yet, via the same date input the create/edit form uses.
 */
function MoveToDateModal({
  item,
  onOpenChange,
  onConfirm,
}: {
  item: PublicScheduleItem;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetDate: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(() => toDatetimeLocal(item.startsAt).slice(0, 10));
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!value) return;
    setPending(true);
    try {
      await onConfirm(value);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={t("moveToDateTitle")}
      icon={CalendarPlusIcon}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={confirm} disabled={!value}>
            {t("moveAction")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-2">
        <label htmlFor="move-to-date" className="text-sm font-medium">
          {t("moveToDateLabel")}
        </label>
        <DateTimeInput id="move-to-date" type="date" value={value} onChange={setValue} />
      </div>
    </Modal>
  );
}

function BulkSchedulePopover({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (publishAt: string | null) => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <CalendarClockIcon className="size-4" />
          {t("bulkScheduleAction")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-muted-foreground text-sm text-pretty">{t("bulkScheduleHint")}</p>
        <DateTimeInput id="bulk-schedule-publish-at" value={value} onChange={setValue} />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!value}
            onClick={async () => {
              await onApply(new Date(value).toISOString());
              setOpen(false);
              setValue("");
            }}
          >
            {t("applyAction")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Day-section header row — also the drop target a dragged row lands on to move to that day. */
function DayGroupHeaderRow({
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

/** Always-present drop target below the table for moving an item to a day with no items yet. */
function NewDayDropzoneRow({ colSpan }: { colSpan: number }) {
  const { t } = useLocale();
  const { setNodeRef, isOver } = useDroppable({ id: "new-day-dropzone" });
  return (
    <TableRow ref={setNodeRef} className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className={cn(
          "text-muted-foreground border-t border-dashed py-2 text-center text-xs",
          isOver && "bg-muted/50 text-foreground",
        )}
      >
        {t("dropNewDayLabel")}
      </TableCell>
    </TableRow>
  );
}

function ActivityRow({
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
    const next = withTimeOfDay(item[field], hhmm);
    if (!next || next === item[field]) return true;
    try {
      const updated = await logisticsApi.updateSchedule(item.id, { [field]: next });
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
    if (next === "meal" && !(item.audiences ?? []).includes("participant")) {
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
    if (item.type === "meal" && !next.includes("participant")) {
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
        return <StatusPill item={item} status={status} />;
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
            disabled={item.type === "meal" || !(item.audiences ?? []).includes("participant")}
            disabledHint={
              item.type === "meal"
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
        return canEdit ? (
          <EditablePublishDateCell
            value={item.publishAt}
            locale={language}
            fieldLabel={t("schedulePublishDateColumn")}
            onSave={savePublishAt}
          />
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
        <TableCell>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-4" />
              <span className="sr-only">{t("dragItemAria")}</span>
            </button>
            <Checkbox
              checked={selected}
              aria-label={t("selectRowAria")}
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
        <TableCell className="text-right">
          <div className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("editItemAria")}
              className="size-7"
              onClick={onOpenEdit}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("duplicate")}
              className="size-7"
              onClick={onDuplicate}
            >
              <CopyIcon className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("deleteItemAria")}
              className="text-destructive size-7"
              onClick={onDelete}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function StatusPill({
  item,
  status,
}: {
  item: PublicScheduleItem;
  status: ReturnType<typeof scheduleStatus>;
}) {
  const { t } = useLocale();
  const badge = (
    <StatusBadge tone={SCHEDULE_STATUS_TONES[status]}>{scheduleStatusLabel(status, t)}</StatusBadge>
  );
  if (status === "scheduled" && item.publishAt) {
    return <span title={new Date(item.publishAt).toLocaleString()}>{badge}</span>;
  }
  return badge;
}

type CellSaveResult = boolean | undefined;

/**
 * Click (mouse or keyboard Enter/Space on the focused trigger) to edit;
 * Enter or blur commits, Escape reverts — the same contract for every
 * inline-editable cell in this table (H59).
 */
function EditableTextCell({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const result = await onSave(nextDraft);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
      >
        {value || <span className="text-muted-foreground">{placeholder ?? "—"}</span>}
      </button>
    );
  }
  // Pops out over neighboring cells instead of clipping when the column is
  // narrower than the content being edited (H59) — the cell itself has no
  // overflow-hidden, so this is free to render past the column's edge.
  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 12rem)" }}
    >
      <Input
        ref={inputRef}
        value={draft}
        disabled={saving}
        data-schedule-focusable="true"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(event) => void commit(event.currentTarget.value)}
        onKeyDown={(e) => {
          if (scheduleNavigationDirection(e)) {
            void commitAndNavigate(e, () => commit(e.currentTarget.value));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-7 w-full border-0 bg-transparent text-sm shadow-none"
      />
    </div>
  );
}

/** HH:MM, 24-hour, e.g. "08:00" or "23:45" — rejects anything else. */
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Plain HH:MM text field, not the native `<input type="time">` — that
 * control's AM/PM-vs-24h rendering follows the OS locale, not this app's
 * locale, so it can't guarantee a 24-hour clock across browsers/systems.
 */
function EditableTimeCell({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    if (!TIME_24H_PATTERN.test(nextDraft)) {
      setDraft(value);
      setEditing(false);
      return false;
    }
    setSaving(true);
    try {
      const result = await onSave(nextDraft);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 w-full rounded px-1 py-0.5 text-left"
      >
        {value}
      </button>
    );
  }
  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 6rem)" }}
    >
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        placeholder="HH:MM"
        value={draft}
        disabled={saving}
        data-schedule-focusable="true"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(event) => void commit(event.currentTarget.value)}
        onKeyDown={(e) => {
          if (scheduleNavigationDirection(e)) {
            void commitAndNavigate(e, () => commit(e.currentTarget.value));
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-7 w-full border-0 bg-transparent font-mono text-sm tabular-nums shadow-none"
      />
    </div>
  );
}

const EMPTY_SCHEDULE_TYPE = "__schedule_type_none__";

function EditableSelectCell({
  value,
  options,
  labelForOption,
  emptyLabel,
  fieldLabel,
  onSave,
}: {
  value: string | null | undefined;
  options: string[];
  labelForOption: (value: string) => string;
  emptyLabel: string;
  fieldLabel: string;
  onSave: (next: string | null) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function change(next: string) {
    setSaving(true);
    try {
      const result = await onSave(next === EMPTY_SCHEDULE_TYPE ? null : next);
      if (result !== false) setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select
      value={value ?? EMPTY_SCHEDULE_TYPE}
      open={open}
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
      onValueChange={(next) => void change(next)}
    >
      <SelectTrigger
        size="sm"
        disabled={saving}
        aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
        onKeyDown={(event) => {
          // Once the menu is open, the native select keyboard controls the
          // options. The table-level arrows apply to the closed cell trigger.
          if (open && event.key !== "Tab") return;
          handleScheduleGridKeyDown(event);
        }}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="w-full border-0 bg-transparent px-1 shadow-none"
      >
        <SelectValue placeholder={emptyLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SCHEDULE_TYPE}>{emptyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labelForOption(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function audienceSummary(
  audiences: ScheduleAudience[],
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (audiences.length === 0) return t("audienceFilterStaffOnly");
  return audiences.map((audience) => scheduleAudienceLabel(audience, t)).join(", ");
}

function EditableAudienceCell({
  audiences,
  fieldLabel,
  onSave,
}: {
  audiences: ScheduleAudience[];
  fieldLabel: string;
  onSave: (next: ScheduleAudience[]) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleAudience[]>(audiences);
  const [saving, setSaving] = useState(false);

  function setPopoverOpen(next: boolean) {
    if (next) setDraft(audiences);
    setOpen(next);
  }

  function toggle(audience: ScheduleAudience, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(audience);
      else next.delete(audience);
      return SCHEDULE_AUDIENCES.filter((option) => next.has(option));
    });
  }

  async function apply() {
    setSaving(true);
    try {
      const result = await onSave(draft);
      if (result !== false) setOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
          aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
          onKeyDown={handleScheduleGridKeyDown}
          data-schedule-focusable="true"
          data-schedule-activate="true"
        >
          {audienceSummary(audiences, t)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="space-y-1">
          {SCHEDULE_AUDIENCES.map((audience) => (
            <div key={audience} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox
                id={`${inputId}-${audience}`}
                checked={draft.includes(audience)}
                disabled={saving}
                onCheckedChange={(checked) => toggle(audience, checked === true)}
              />
              <Label htmlFor={`${inputId}-${audience}`}>{scheduleAudienceLabel(audience, t)}</Label>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void apply()}>
            {t("applyAction")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EditableScannableCell({
  checked,
  disabled,
  disabledHint,
  fieldLabel,
  onSave,
}: {
  checked: boolean;
  disabled: boolean;
  disabledHint?: string;
  fieldLabel: string;
  onSave: (next: boolean) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const inputId = useId();
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setSaving(true);
    try {
      await onSave(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex min-h-8 items-center gap-2 rounded px-1 py-0.5 text-sm"
      title={disabledHint}
    >
      <Checkbox
        id={inputId}
        checked={checked}
        disabled={disabled || saving}
        aria-label={fieldLabel}
        onKeyDown={handleScheduleGridKeyDown}
        onCheckedChange={(next) => void change(next === true)}
        data-schedule-focusable="true"
      />
      <Label htmlFor={inputId}>{checked ? t("yesLabel") : t("noLabel")}</Label>
    </div>
  );
}

function EditablePublishDateCell({
  value,
  locale,
  fieldLabel,
  onSave,
}: {
  value: string | null;
  locale: string;
  fieldLabel: string;
  onSave: (next: string | null) => Promise<CellSaveResult>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDatetimeLocal(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(toDatetimeLocal(value));
  }, [value, editing]);

  async function commit(nextDraft = draft): Promise<boolean> {
    if (saving) return false;
    const parsed = nextDraft ? new Date(nextDraft) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return false;
    const next = parsed ? parsed.toISOString() : null;
    if (next === value) {
      setEditing(false);
      return true;
    }
    setSaving(true);
    try {
      const result = await onSave(next);
      const saved = result !== false;
      if (saved) setEditing(false);
      return saved;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveScheduleItem"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        onKeyDown={handleScheduleGridKeyDown}
        data-schedule-focusable="true"
        data-schedule-activate="true"
        className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
        aria-label={t("editScheduleFieldAria", { field: fieldLabel })}
      >
        {value ? formatScheduledDateTime(value, locale) : t("notSet")}
      </button>
    );
  }

  return (
    <div
      className="bg-popover border-border absolute inset-y-0 left-0 z-20 flex items-center rounded-md border shadow-md"
      style={{ width: "max(100%, 15rem)" }}
    >
      <DateTimeInput
        value={draft}
        onChange={setDraft}
        onBlur={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          void commit(next);
        }}
        onClear={() => void commit("")}
        onKeyDown={(event) => {
          if (scheduleNavigationDirection(event)) {
            void commitAndNavigate(event, () => commit(event.currentTarget.value));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            setDraft(toDatetimeLocal(value));
            setEditing(false);
          }
        }}
        disabled={saving}
        aria-label={fieldLabel}
        data-schedule-focusable="true"
        className="h-7 border-0 bg-transparent shadow-none"
      />
    </div>
  );
}

/** Responsible-person editor (H59), a compact popover version of the schedule editor's OwnersField. */
function EditableOwnersCell({
  item,
  onUpdate,
}: {
  item: PublicScheduleItem;
  onUpdate: (patch: Partial<PublicScheduleItem>) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [freeTextName, setFreeTextName] = useState("");
  const [busy, setBusy] = useState(false);
  const owners = item.owners ?? [];

  const ownerUserIds = new Set(owners.flatMap((o) => (o.userId ? [o.userId] : [])));
  async function searchAvailableUsers(query: string): Promise<UserOption[]> {
    try {
      const r = await logisticsApi.scheduleOwnerCandidates(query);
      return r.users.filter((u) => !ownerUserIds.has(u.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) toast.error(t("needScheduleManageSearch"));
      else toast.error(t("searchFailed"));
      return [];
    }
  }

  async function refresh() {
    const r = await logisticsApi.scheduleOwners(item.id);
    onUpdate({ owners: r.owners });
  }

  async function add(input: { userId: number } | { freeTextName: string }) {
    setBusy(true);
    try {
      await logisticsApi.addScheduleOwner(item.id, input);
      setSelectedUserId("");
      setFreeTextName("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(ownerId: number) {
    setBusy(true);
    try {
      await logisticsApi.removeScheduleOwner(item.id, ownerId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted -mx-1 block w-full truncate rounded px-1 py-0.5 text-left"
          onKeyDown={handleScheduleGridKeyDown}
          data-schedule-focusable="true"
          data-schedule-activate="true"
        >
          {ownerNames(item) || <span className="text-muted-foreground">{t("noOwnersYet")}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <UserPicker
            value={selectedUserId}
            onChange={setSelectedUserId}
            search={searchAvailableUsers}
            minQueryLength={2}
            inDialog
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !selectedUserId}
            onClick={() => add({ userId: Number(selectedUserId) })}
          >
            {t("addAction")}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            value={freeTextName}
            onChange={(e) => setFreeTextName(e.target.value)}
            placeholder={t("ownerFreeTextPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (freeTextName.trim()) add({ freeTextName: freeTextName.trim() });
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !freeTextName.trim()}
            onClick={() => add({ freeTextName: freeTextName.trim() })}
          >
            {t("addAction")}
          </Button>
        </div>
        {owners.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noOwnersYet")}</p>
        ) : (
          <ul className="space-y-1">
            {owners.map((owner) => (
              <li key={owner.id} className="flex items-center justify-between gap-2 text-sm">
                {ownerDisplayName(owner) || t("noOwnersYet")}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={t("remove")}
                  disabled={busy}
                  onClick={() => remove(owner.id)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
