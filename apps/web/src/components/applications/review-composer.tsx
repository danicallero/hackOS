"use client";

// The reviewer's score + notes card: floating over the modal on desktop,
// inline on small screens, and alone in the companion review window.

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FileViewerSide } from "@/components/applications/review-file-docking";
import { IconButton } from "@/components/common/icon-button";
import { SaveStatus } from "@/components/common/save-status";
import { ScaleButtons } from "@/components/common/scale-buttons";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { cn } from "@/lib/utils";

const FLOATING_REVIEW_POSITION_STORAGE_KEY = "hackos.application-review.floating-review-position";

export interface ReviewComposerProps {
  responseId: number;
  myScore: number | null;
  onScoreChange: (v: number | null) => void;
  myNotes: string;
  onNotesChange: (v: string) => void;
  reviewSaveState: SaveState;
  onOpenReviewWindow?: () => void;
  dockSide?: FileViewerSide;
  dragHandle?: React.ReactNode;
}

function ReviewComposerFields({
  myScore,
  onScoreChange,
  myNotes,
  onNotesChange,
  reviewSaveState,
}: {
  responseId: number;
  myScore: number | null;
  onScoreChange: (v: number | null) => void;
  myNotes: string;
  onNotesChange: (v: string) => void;
  reviewSaveState: SaveState;
}) {
  const { t } = useLocale();
  const notesId = useId();
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs">{t("scoreRangeLabel")}</Label>
        <ScaleButtons
          value={myScore}
          onChange={onScoreChange}
          min={0}
          max={5}
          clearSize="xs"
          className="flex-wrap gap-1 overflow-visible"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={notesId} className="text-muted-foreground text-xs">
            {t("notesLabel")}
          </Label>
          <SaveStatus state={reviewSaveState} />
        </div>
        <Textarea
          id={notesId}
          rows={3}
          value={myNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={t("reviewNotesPlaceholder")}
        />
      </div>
    </>
  );
}

export function ReviewPanelCard({
  className,
  dragHandle,
  ...props
}: ReviewComposerProps & { className?: string }) {
  const { t } = useLocale();
  return (
    <div
      className={cn(
        "border-border bg-popover space-y-3 rounded-lg border p-4 shadow-floating",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        {dragHandle}
        <p className="min-w-0 flex-1 text-sm font-medium">{t("yourReview")}</p>
        {props.onOpenReviewWindow && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={props.onOpenReviewWindow}
            label={t("openReviewWindow")}
          >
            <ArrowSquareOutIcon aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <ReviewComposerFields {...props} />
    </div>
  );
}

export function FloatingReviewPanel(props: ReviewComposerProps) {
  const { t } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // The panel belongs to the review workspace, not to one applicant. Keep the
  // same coordinate while the modal navigates between response records.
  const positionStorageKey = FLOATING_REVIEW_POSITION_STORAGE_KEY;

  const clampPosition = useCallback((left: number, top: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    const margin = 16;
    const width = rect?.width ?? 384;
    const height = rect?.height ?? 300;
    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin)),
    };
  }, []);

  useEffect(() => {
    let saved: { left: number; top: number } | null = null;
    try {
      const raw = window.localStorage.getItem(positionStorageKey);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (
          typeof value === "object" &&
          value !== null &&
          "left" in value &&
          "top" in value &&
          typeof value.left === "number" &&
          typeof value.top === "number"
        ) {
          saved = { left: value.left, top: value.top };
        }
      }
    } catch {
      // A blocked localStorage is not a reason to make the review unusable.
    }
    setPosition(saved ? clampPosition(saved.left, saved.top) : null);
  }, [clampPosition]);

  useEffect(() => {
    if (!position) return;
    try {
      window.localStorage.setItem(positionStorageKey, JSON.stringify(position));
    } catch {
      // Position persistence is best-effort.
    }
  }, [position]);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => (current ? clampPosition(current.left, current.top) : current));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampPosition]);

  function startDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    setPosition({ left: rect.left, top: rect.top });
  }

  function moveDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setPosition(
      clampPosition(
        drag.startLeft + event.clientX - drag.startX,
        drag.startTop + event.clientY - drag.startY,
      ),
    );
  }

  function stopDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function moveWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 48 : 24;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const current = position ?? { left: rect?.left ?? 16, top: rect?.top ?? 16 };
    event.preventDefault();
    event.stopPropagation();
    setPosition(clampPosition(current.left + delta[0], current.top + delta[1]));
  }

  const panelStyle: CSSProperties = position
    ? { left: position.left, top: position.top }
    : {
        bottom: "1rem",
        right:
          props.dockSide === "left"
            ? "max(1rem, calc(50% - 42.5rem))"
            : props.dockSide === "right"
              ? "max(1rem, calc(50% - 11.5rem))"
              : "max(1rem, calc(50% - 27rem))",
      };

  const dragHandle = (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "text-muted-foreground",
        "button-static cursor-grab touch-none active:cursor-grabbing",
      )}
      onPointerDown={startDragging}
      onPointerMove={moveDragging}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={moveWithKeyboard}
      label={t("moveReviewPanel")}
    >
      <DotsSixVerticalIcon aria-hidden="true" />
    </IconButton>
  );

  return (
    <div
      ref={panelRef}
      data-dialog-floating
      className="pointer-events-auto fixed z-[70] w-[min(24rem,calc(100vw-2rem))] rounded-lg"
      style={panelStyle}
    >
      <ReviewPanelCard {...props} dragHandle={dragHandle} />
    </div>
  );
}

export function InlineReviewPanel(props: ReviewComposerProps) {
  return (
    <ReviewPanelCard {...props} className="rounded-none border-0 border-t px-0 pt-5 shadow-none" />
  );
}
