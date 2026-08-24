"use client";

// Generic drag-and-drop primitives shared by list builders (applications'
// question builder, H11; the challenge judging panel builder): a keyboard-
// and pointer-accessible drag handle, plus a thin wrapper around dnd-kit's
// useSortable so callers stay focused on domain logic (which item moved
// where) instead of dnd-kit's API.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Grip handle: pointer-draggable, and focusable/operable via keyboard (dnd-kit's
 *  KeyboardSensor wires Space/Enter to pick up, arrows to move, Escape to cancel). */
export function DragHandle({
  attributes,
  listeners,
  label,
  disabled,
}: {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing"
      {...attributes}
      {...listeners}
      disabled={disabled}
    >
      <GripVerticalIcon className="size-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Sortable wrapper for one item in a flat (or grouped) drag-and-drop list. */
export function SortableItem({
  id,
  data,
  children,
}: {
  id: string;
  data?: Record<string, unknown>;
  children: (drag: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
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
