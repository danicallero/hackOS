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
import { LockIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { StatusBadge } from "@/components/common/status-badge";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import type { RoleSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUPERADMIN_NAME = "system:superadmin";

/**
 * Discord-style flat, reorderable role list (H8). Drag or keyboard-move a row
 * to reorder — the new position is the midpoint between its new neighbors'
 * `position` values; when there isn't room, `onReorder` reports failure and
 * the caller reverts. `system:superadmin` is real state worth seeing (who
 * holds it) but is never draggable or selectable-as-editable the way other
 * roles are, so it's pinned above the reorderable list with a System badge.
 */
export function RoleList({
  roles,
  selectedId,
  onSelect,
  onReorder,
}: {
  roles: RoleSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onReorder: (roleId: number, newPosition: number) => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");

  const superadmin = roles.find((r) => r.name === SUPERADMIN_NAME) ?? null;
  const sortable = useMemo(
    () =>
      [...roles].filter((r) => r.name !== SUPERADMIN_NAME).sort((a, b) => b.position - a.position),
    [roles],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortable;
    return sortable.filter((r) => r.name.toLowerCase().includes(needle));
  }, [sortable, query]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = sortable.findIndex((r) => String(r.id) === String(active.id));
    const toIndex = sortable.findIndex((r) => String(r.id) === String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = arrayMove(sortable, fromIndex, toIndex);
    const newPosition = computeNewPosition(reordered, toIndex);
    if (newPosition === null) return;
    onReorder(reordered[toIndex].id, newPosition);
  }

  return (
    <div className="flex flex-col">
      <div className="relative border-b p-2">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-5 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filterRolesPlaceholder")}
          className="pl-8"
          aria-label={t("filterRolesPlaceholder")}
        />
      </div>
      <ul className="divide-border divide-y">
        {superadmin && (
          <RoleRow
            role={superadmin}
            selected={selectedId === superadmin.id}
            onSelect={() => onSelect(superadmin.id)}
            locked
          />
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={filtered.map((r) => String(r.id))}
            strategy={verticalListSortingStrategy}
          >
            {filtered.map((role) => (
              <SortableItem key={role.id} id={String(role.id)}>
                {({ attributes, listeners }) => (
                  <RoleRow
                    role={role}
                    selected={selectedId === role.id}
                    onSelect={() => onSelect(role.id)}
                    dragHandle={
                      <DragHandle
                        attributes={attributes}
                        listeners={listeners}
                        label={t("dragToReorderAria", { name: role.name })}
                      />
                    }
                  />
                )}
              </SortableItem>
            ))}
          </SortableContext>
        </DndContext>
      </ul>
    </div>
  );
}

function RoleRow({
  role,
  selected,
  onSelect,
  dragHandle,
  locked,
}: {
  role: RoleSummary;
  selected: boolean;
  onSelect: () => void;
  dragHandle?: React.ReactNode;
  locked?: boolean;
}) {
  const { t } = useLocale();
  return (
    <li className={cn("flex items-center gap-1 px-1", selected && "bg-muted")}>
      {dragHandle ??
        (locked ? <span className="flex size-8 shrink-0 items-center justify-center" /> : null)}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{role.name}</span>
          {locked && (
            <StatusBadge tone="neutral" dot={false} className="shrink-0">
              <LockIcon className="size-3" /> {t("systemRoleBadge")}
            </StatusBadge>
          )}
          {!locked && role.isProtected && (
            <StatusBadge tone="neutral" dot={false} className="shrink-0">
              {t("protectedRoleBadge")}
            </StatusBadge>
          )}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {role.memberIds.length}
        </span>
      </button>
    </li>
  );
}

/**
 * Midpoint between the new neighbors of `reordered[toIndex]`. Returns null
 * when there's no integer room left (adjacent positions), so the caller can
 * refuse the move instead of colliding with an existing role.
 */
export function computeNewPosition(reordered: RoleSummary[], toIndex: number): number | null {
  const above = reordered[toIndex - 1];
  const below = reordered[toIndex + 1];
  if (!above && !below) return null;
  if (!above) return below.position + 100;
  if (!below) return above.position - 100;
  const mid = Math.floor((above.position + below.position) / 2);
  if (mid === above.position || mid === below.position) return null;
  return mid;
}
