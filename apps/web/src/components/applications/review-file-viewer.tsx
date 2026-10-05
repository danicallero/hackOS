"use client";

import { useDraggable } from "@dnd-kit/core";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { useCallback, useEffect, useRef, useState } from "react";
import { DragHandle } from "@/components/common/drag-handle";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type FileViewerSide, fileViewerDockStyle } from "./review-file-docking";

export interface ApplicationFile {
  fieldKey: string;
  label: string;
  value: string | null;
  filename: string;
  href: string | null;
  preview: "image" | "pdf" | "download" | "empty";
}

export function ApplicationFileViewer({
  files,
  activeIndex,
  side,
  onIndexChange,
  onSideChange,
  dragHandle,
  className,
}: {
  files: ApplicationFile[];
  activeIndex: number;
  side: FileViewerSide;
  onIndexChange: (index: number) => void;
  onSideChange: (side: FileViewerSide) => void;
  dragHandle?: React.ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const previewRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(document.fullscreenElement === previewRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  if (files.length === 0) return null;

  const file = files[activeIndex] ?? files[0];
  const fileTitle = file.filename ? `${file.label}: ${file.filename}` : file.label;
  const nextSide = side === "left" ? "right" : "left";

  async function toggleFullscreen() {
    const preview = previewRef.current;
    if (!preview) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await preview.requestFullscreen();
    } catch {
      // Fullscreen can be denied by the browser or an embedding context.
    }
  }

  return (
    <section
      aria-label={t("applicationFilesLabel")}
      className={cn(
        "border-border bg-card flex min-h-0 flex-col space-y-3 overflow-hidden rounded-xl border p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="type-section-title min-w-0 truncate text-balance" title={file.label}>
          {file.label}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {file.href && (
            <>
              <a
                href={file.href}
                target="_blank"
                rel="noreferrer"
                className={dialogIconButtonClass}
                aria-label={t("viewFileLabel")}
                title={t("viewFileLabel")}
              >
                <ArrowSquareOutIcon aria-hidden="true" />
              </a>
              <button
                type="button"
                className={dialogIconButtonClass}
                onClick={() => void toggleFullscreen()}
                aria-label={t(isFullscreen ? "exitFullscreenFile" : "fullscreenFile")}
                aria-pressed={isFullscreen}
                title={t(isFullscreen ? "exitFullscreenFile" : "fullscreenFile")}
              >
                {isFullscreen ? (
                  <ArrowsInSimpleIcon aria-hidden="true" />
                ) : (
                  <ArrowsOutSimpleIcon aria-hidden="true" />
                )}
              </button>
            </>
          )}
          {dragHandle ?? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => onSideChange(nextSide)}
              className="hidden lg:inline-flex"
              aria-label={t("moveFileViewer", {
                side: t(nextSide === "left" ? "leftSide" : "rightSide"),
              })}
            >
              <DotsSixVerticalIcon aria-hidden="true" />
            </Button>
          )}
          {files.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={dialogIconButtonClass}
                disabled={activeIndex === 0}
                onClick={() => onIndexChange(Math.max(0, activeIndex - 1))}
                aria-label={t("previousFile")}
                title={t("previousFile")}
              >
                <CaretLeftIcon aria-hidden="true" />
              </button>
              <span
                className="text-muted-foreground min-w-14 text-center text-xs tabular-nums"
                aria-live="polite"
              >
                {t("filePosition", { current: activeIndex + 1, total: files.length })}
              </span>
              <button
                type="button"
                className={dialogIconButtonClass}
                disabled={activeIndex === files.length - 1}
                onClick={() => onIndexChange(Math.min(files.length - 1, activeIndex + 1))}
                aria-label={t("nextFile")}
                title={t("nextFile")}
              >
                <CaretRightIcon aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        ref={previewRef}
        className={cn(
          "min-h-0 flex-1 overflow-auto rounded-control border bg-background",
          isFullscreen &&
            "flex h-screen w-screen items-center justify-center rounded-none border-0 p-6",
        )}
      >
        {file.preview === "empty" ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <FileTextIcon className="text-muted-foreground size-8" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">{t("noFileUploadedPeriod")}</p>
          </div>
        ) : file.preview === "pdf" && file.href ? (
          <iframe
            key={file.value ?? file.fieldKey}
            src={file.href}
            title={fileTitle}
            className={cn("h-[min(62vh,48rem)] w-full", isFullscreen && "h-full")}
          />
        ) : file.preview === "image" && file.href ? (
          <div
            className={cn(
              "flex min-h-64 items-center justify-center bg-muted p-3 sm:p-6",
              isFullscreen && "h-full w-full min-h-0",
            )}
          >
            {/* biome-ignore lint/performance/noImgElement: private authenticated file proxy cannot be optimized by Next Image */}
            <img
              key={file.value ?? file.fieldKey}
              src={file.href}
              alt={fileTitle}
              className={cn("max-h-[62vh] max-w-full object-contain", isFullscreen && "max-h-full")}
            />
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <FileTextIcon className="text-muted-foreground size-8" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">{t("filePreviewUnavailable")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function ApplicationFileViewerPanel({
  files,
  activeIndex,
  side,
  onIndexChange,
  onSideChange,
  reviewContent,
}: {
  files: ApplicationFile[];
  activeIndex: number;
  side: FileViewerSide;
  onIndexChange: (index: number) => void;
  onSideChange: (side: FileViewerSide) => void;
  reviewContent?: React.ReactNode;
}) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLElement | null>(null);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: "application-file-viewer",
    data: { getRect: () => panelRef.current?.getBoundingClientRect() },
  });
  const setPanelRef = useCallback(
    (node: HTMLElement | null) => {
      panelRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef],
  );
  return (
    <aside
      ref={setPanelRef}
      data-dialog-floating
      data-file-viewer-side={side}
      data-file-viewer-dragging={isDragging || undefined}
      className={cn(
        "pointer-events-auto fixed z-[60] hidden 2xl:grid 2xl:gap-4",
        reviewContent ? "2xl:grid-rows-[minmax(0,1fr)_auto]" : "2xl:grid-rows-[minmax(0,1fr)]",
        isDragging && "pointer-events-none opacity-0",
      )}
      style={fileViewerDockStyle(side)}
      aria-label={t("applicationFilesLabel")}
    >
      <div className={cn("min-h-0 rounded-overlay", isDragging && "opacity-0")}>
        <ApplicationFileViewer
          files={files}
          activeIndex={activeIndex}
          side={side}
          onIndexChange={onIndexChange}
          onSideChange={onSideChange}
          dragHandle={
            <DragHandle
              attributes={attributes}
              listeners={listeners}
              label={t("moveFileViewer", { side: t(side === "left" ? "rightSide" : "leftSide") })}
            />
          }
          className="h-full"
        />
      </div>
      {reviewContent && (
        <div className={cn("min-h-0 rounded-overlay", isDragging && "opacity-0")}>
          {reviewContent}
        </div>
      )}
    </aside>
  );
}
