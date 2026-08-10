"use client";

// Drag-and-drop primitives for the question builder (H11): a keyboard- and
// pointer-accessible drag handle, plus thin wrappers around dnd-kit's
// useSortable/useDroppable so questions-card.tsx can stay focused on the
// domain logic (which field/section moved where) instead of dnd-kit's API.

import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Grip handle: pointer-draggable, and focusable/operable via keyboard (dnd-kit's
 *  KeyboardSensor wires Space/Enter to pick up, arrows to move, Escape to cancel). */
export function DragHandle({
  attributes,
  listeners,
  label,
}: {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  label: string;
}) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="size-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Sortable wrapper for one field card within its section/ungrouped block. */
export function SortableField({
  id,
  children,
}: {
  id: string;
  children: (drag: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { type: "field" },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-60")}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/** Sortable wrapper for one section block (drag handle lives on its header). */
export function SortableSection({
  id,
  children,
}: {
  id: string;
  children: (drag: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
  }) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data: { type: "section" } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-60")}
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </div>
  );
}

/** Makes a block's field list a valid drop target even when it has zero
 *  fields (a plain SortableContext provides no drop surface when empty). */
export function DroppableBlock({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "ring-primary/40 rounded-lg ring-2 ring-offset-2")}
    >
      {children}
    </div>
  );
}

/** Empty-block placeholder shown inside a section/ungrouped block with no fields. */
export function EmptyBlockHint() {
  const { t } = useLocale();
  return (
    <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
      {t("dropQuestionsHereDesc")}
    </p>
  );
}
