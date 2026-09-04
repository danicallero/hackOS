"use client";

// Generic drag-and-drop primitives shared by list builders (applications'
// question builder, H11; the challenge judging panel builder): a keyboard-
// and pointer-accessible drag handle, plus a thin wrapper around dnd-kit's
// useSortable so callers stay focused on domain logic (which item moved
// where) instead of dnd-kit's API.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { IconButton } from "@/components/common/icon-button";
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
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={label}
      className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 cursor-grab touch-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
      disabled={disabled}
    >
      <GripVerticalIcon className="size-4" aria-hidden="true" />
    </IconButton>
  );
}

/** Sortable wrapper for one item in a flat (or grouped) drag-and-drop list.
 *
 *  `hideWhileDragging` is for callers that render a `DragOverlay` clone of
 *  the active item: the real item goes fully transparent (instead of the
 *  default translucent-in-place look) so only the overlay clone is visible
 *  while dragging, which is what avoids the snap/jump on drop — without an
 *  overlay, the real item's position resets one frame before the reordered
 *  array commits. */
export function SortableItem({
  id,
  data,
  hideWhileDragging = false,
  children,
}: {
  id: string;
  data?: Record<string, unknown>;
  hideWhileDragging?: boolean;
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
      className={cn(isDragging && (hideWhileDragging ? "opacity-0" : "z-10 opacity-60"))}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/** Standard drop animation for a `DragOverlay` clone: eases into its final
 *  slot instead of just vanishing, without the sidewaysScale dnd-kit uses by
 *  default (which reads as a jump on short list rows). */
export const dragOverlayDropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};
