"use client";

import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type CSSProperties, useState } from "react";
import { createPortal } from "react-dom";
import { dragOverlayDropAnimation, useReducedDragMotion } from "@/components/common/drag-handle";
import { useLocale } from "@/lib/i18n";

export type FileViewerSide = "left" | "right";
type ViewerSize = { width: number; height: number };

/** H12: source, destination preview and committed dock share one geometry. */
export function fileViewerDockStyle(side: FileViewerSide, size?: ViewerSize): CSSProperties {
  const width = size ? `${size.width}px` : "min(30rem,calc(100vw - 2rem))";
  const height = size ? `${size.height}px` : "min(90vh,54rem)";
  const halfHeight = size ? `${size.height / 2}px` : "min(45vh,27rem)";
  return {
    width,
    height,
    top: `calc(50% - ${halfHeight})`,
    left: side === "left" ? `calc(50% - 13.5rem - ${width})` : "calc(50% + 13.5rem)",
  };
}

const dockCollision: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

// H12: the viewer has two docking destinations, not a sortable list. Arrow
// keys select the destination directly; Space/Enter commit and Escape cancel.
const dockKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  const side = event.code === "ArrowLeft" ? "left" : event.code === "ArrowRight" ? "right" : null;
  if (!side) return;
  event.preventDefault();
  const destination = context.droppableRects.get(side);
  const source = context.collisionRect;
  if (!destination || !source) return;
  return {
    x:
      currentCoordinates.x +
      destination.left +
      destination.width / 2 -
      source.left -
      source.width / 2,
    y:
      currentCoordinates.y +
      destination.top +
      destination.height / 2 -
      source.top -
      source.height / 2,
  };
};

export function FileViewerDocking({
  side,
  onSideChange,
  onDraggingChange,
  onPreviewSideChange,
  overlay,
  children,
}: {
  side: FileViewerSide;
  onSideChange: (side: FileViewerSide) => void;
  onDraggingChange: (dragging: boolean) => void;
  onPreviewSideChange: (side: FileViewerSide | null) => void;
  overlay?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const reducedMotion = useReducedDragMotion();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: dockKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState(false);
  const [previewSide, setPreviewSide] = useState<FileViewerSide | null>(null);
  const [activeSize, setActiveSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <DndContext
      sensors={sensors}
      autoScroll={false}
      collisionDetection={dockCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        screenReaderInstructions: { draggable: t("moveFileViewerHint") },
        announcements: {
          onDragStart: () => t("moveFileViewerHint"),
          onDragOver: ({ over }) =>
            over
              ? t("moveFileViewer", { side: t(over.id === "left" ? "leftSide" : "rightSide") })
              : undefined,
          onDragEnd: ({ over }) =>
            t("moveFileViewer", {
              side: t((over?.id ?? side) === "left" ? "leftSide" : "rightSide"),
            }),
          onDragCancel: () => t("cancel"),
        },
      }}
      onDragStart={({ active }) => {
        setDragging(true);
        onDraggingChange(true);
        const rect = active.data.current?.getRect?.() ?? active.rect.current.initial;
        if (rect) setActiveSize({ width: rect.width, height: rect.height });
      }}
      onDragOver={({ over }) => {
        const destination = over?.id === "left" || over?.id === "right" ? over.id : null;
        setPreviewSide(destination);
        onPreviewSideChange(destination);
      }}
      onDragCancel={() => {
        setPreviewSide(null);
        onPreviewSideChange(null);
        setDragging(false);
        onDraggingChange(false);
        setActiveSize(null);
      }}
      onDragEnd={({ over }) => {
        setPreviewSide(null);
        onPreviewSideChange(null);
        setDragging(false);
        onDraggingChange(false);
        setActiveSize(null);
        if (over?.id === "left" || over?.id === "right") onSideChange(over.id);
      }}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <>
            <DockTarget side="left" />
            <DockTarget side="right" />
            {dragging && activeSize && (
              <div
                data-dialog-floating
                data-file-viewer-preview-slot={previewSide ?? side}
                aria-hidden="true"
                style={fileViewerDockStyle(previewSide ?? side, activeSize)}
                className="pointer-events-none fixed z-[80] hidden items-center justify-center rounded-overlay border-2 border-dashed border-primary/60 bg-primary/5 px-4 text-center text-sm text-primary transition-[left] duration-200 motion-reduce:transition-none 2xl:flex"
              >
                {t("dropFileViewerHere")}
              </div>
            )}
            <DragOverlay
              zIndex={90}
              dropAnimation={reducedMotion ? null : dragOverlayDropAnimation}
            >
              {dragging && (
                <div
                  inert
                  aria-hidden="true"
                  data-dialog-floating
                  data-file-viewer-drag-overlay
                  style={activeSize ?? undefined}
                  className="overflow-hidden rounded-overlay bg-card shadow-overlay outline-2 outline-primary"
                >
                  {overlay}
                </div>
              )}
            </DragOverlay>
          </>,
          document.body,
        )}
    </DndContext>
  );
}

function DockTarget({ side }: { side: FileViewerSide }) {
  const { setNodeRef, isOver } = useDroppable({ id: side });
  return (
    <div
      ref={setNodeRef}
      data-dialog-floating
      data-file-viewer-dropzone={side}
      data-drop-active={isOver || undefined}
      aria-hidden="true"
      className="pointer-events-none fixed inset-y-0 z-[70] hidden w-1/2 2xl:block"
      style={{ left: side === "left" ? 0 : "50%" }}
    />
  );
}
