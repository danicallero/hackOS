"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createContext, useContext, useMemo } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { DragHandle } from "@/components/common/drag-handle";
import { TableRow } from "@/components/ui/table";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type Enterprise, groupEnterprises } from "./shared";

type DragBindings = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;
const DragBindingsContext = createContext<DragBindings | null>(null);

const GROUP_PREFIX = "group:";
const NEW_GROUP = `${GROUP_PREFIX}new`;

function SortableEnterpriseRow({
  id,
  props,
  children,
}: {
  id: string;
  props: { className?: string; onClick?: () => void };
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const bindings = useMemo(() => ({ attributes, listeners }), [attributes, listeners]);
  return (
    <DragBindingsContext.Provider value={bindings}>
      <TableRow
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(props.className, isDragging && "relative z-10 bg-muted opacity-70")}
        onClick={props.onClick}
      >
        {children}
      </TableRow>
    </DragBindingsContext.Provider>
  );
}

function RowHandle({ name }: { name: string }) {
  const { t } = useLocale();
  const bindings = useContext(DragBindingsContext);
  if (!bindings) return null;
  return (
    <DragHandle
      attributes={bindings.attributes}
      listeners={bindings.listeners}
      label={t("dragToReorderAria", { name })}
    />
  );
}

function DropSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn("space-y-2 rounded-lg", isOver && "outline-2 outline-dashed outline-primary")}
    >
      <h2 className="font-medium text-sm">{title}</h2>
      {children}
    </section>
  );
}

/** H45: one table per priority, same columns as the list; drag a row to reorder it or into another priority. */
export function GroupedEnterprises({
  enterprises,
  columns,
  busy,
  onMove,
}: {
  enterprises: Enterprise[];
  columns: Column<Enterprise>[];
  busy: boolean;
  /** Final order of the target priority tier (`priority` undefined keeps the tier's own priority). */
  onMove: (ids: number[], priority: number) => void;
}) {
  const { t } = useLocale();
  const groups = useMemo(() => groupEnterprises(enterprises), [enterprises]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const tableColumns = useMemo(
    () => columns.filter((column) => column.id !== "priority"),
    [columns],
  );
  const nextPriority = Math.max(0, ...groups.map((g) => g.priority ?? 0)) + 1;

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || busy || active.id === over.id) return;
    const activeId = Number(active.id);
    const source = groups.find((g) => g.items.some((e) => e.id === activeId));
    if (!source) return;
    const overId = String(over.id);
    let target = source;
    let index: number;
    if (overId.startsWith(GROUP_PREFIX)) {
      const priority =
        overId === NEW_GROUP ? nextPriority : Number(overId.slice(GROUP_PREFIX.length));
      target = groups.find((g) => g.priority === priority) ?? { priority, items: [] };
      index = target.items.length;
    } else {
      const found = groups.find((g) => g.items.some((e) => String(e.id) === overId));
      if (!found) return;
      target = found;
      index = found.items.findIndex((e) => String(e.id) === overId);
    }
    if (target.priority == null) return;
    const ids = target.items.map((e) => e.id).filter((id) => id !== activeId);
    ids.splice(index, 0, activeId);
    onMove(ids, target.priority);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="space-y-8">
        {groups.map((group) => (
          <DropSection
            key={group.priority ?? "none"}
            id={`${GROUP_PREFIX}${group.priority ?? "none"}`}
            title={
              group.priority != null
                ? t("priorityGroupLabel", { priority: group.priority })
                : t("noPriority")
            }
          >
            <SortableContext
              items={group.items.map((e) => String(e.id))}
              strategy={verticalListSortingStrategy}
            >
              <DataTable
                columns={tableColumns}
                data={group.items}
                getRowId={(e) => String(e.id)}
                getRowHref={(e) => `/enterprises/${e.id}`}
                getRowLabel={(e) => e.name}
                rowActions={(e) => <RowHandle name={e.name} />}
                renderRow={(e, props, cells) => (
                  <SortableEnterpriseRow key={e.id} id={String(e.id)} props={props}>
                    {cells}
                  </SortableEnterpriseRow>
                )}
              />
            </SortableContext>
          </DropSection>
        ))}
        <DropSection id={NEW_GROUP} title={t("newPriorityGroup", { priority: nextPriority })}>
          <div className="h-12 rounded-lg border border-dashed" />
        </DropSection>
      </div>
    </DndContext>
  );
}
