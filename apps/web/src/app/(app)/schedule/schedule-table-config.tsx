"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SlidersHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableHead } from "@/components/ui/table";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { uiPrefsApi } from "@/lib/logistics";

// --- Column configuration (H59): which columns show, and in what order,
// persisted in localStorage for an instant read and synced to the account
// so it follows the user across devices. -----------------------------------

export type ColumnId =
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

export const COLUMN_LABEL_KEYS: Record<ColumnId, MessageKey> = {
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

export const REQUIRED_COLUMNS: ColumnId[] = ["item"];

/**
 * Grid addresses for the two fixed columns that aren't configurable data
 * columns — the row-selection checkbox and the row actions. They can't be
 * hidden or reordered, so they live outside ColumnId, but they still take part
 * in arrow-key navigation (H59).
 */
export const SELECT_COLUMN = "__select__";
export const ACTIONS_COLUMN = "__actions__";
const KEYBOARD_COLUMNS: ColumnId[] = [
  "status",
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

export interface TableConfig {
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

export function isKeyboardColumn(id: ColumnId): boolean {
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

export function useScheduleTableConfig(): [TableConfig, (next: TableConfig) => void] {
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

export function ColumnConfigPopover({
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
export function ResizableHead({
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
