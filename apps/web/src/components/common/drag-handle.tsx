"use client";

// Generic drag-and-drop primitives shared by list builders (applications'
// question builder, H11; the challenge judging panel builder): a keyboard-
// and pointer-accessible drag handle, plus a thin wrapper around dnd-kit's
// useSortable so callers stay focused on domain logic (which item moved
// where) instead of dnd-kit's API.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { useSyncExternalStore } from "react";
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
      className="button-static text-muted-foreground hover:bg-muted hover:text-foreground -ml-1.5 cursor-grab touch-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
      disabled={disabled}
    >
      <DotsSixVerticalIcon className="size-4" aria-hidden="true" />
    </IconButton>
  );
}

/** Sortable wrapper for a list item. With an overlay, the active item keeps
 * its dimensions and marks the destination while siblings shift (issue #849). */
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
      data-drop-placeholder={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative motion-reduce:transition-none!",
        isDragging &&
          hideWhileDragging &&
          "rounded-lg outline-2 outline-dashed outline-primary bg-primary/5",
        isDragging && !hideWhileDragging && "z-10 opacity-60",
      )}
    >
      <div className={cn(isDragging && hideWhileDragging && "opacity-0")}>
        {children({ attributes, listeners })}
      </div>
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

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useReducedDragMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false,
  );
}
