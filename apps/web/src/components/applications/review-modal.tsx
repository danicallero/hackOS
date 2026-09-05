"use client";

// Review one submitted application response. Lives here rather than in
// applications/[id] because users/[id] opens the same modal from a person's
// profile, and a route's page.tsx must not be imported by another route.

import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GavelIcon,
  GripVerticalIcon,
  Maximize2Icon,
  Minimize2Icon,
  PencilIcon,
  SaveIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  type FormSection,
  fmtScore,
  type ResponseRow,
  type ReviewEntry,
  statusTone,
  type TemplateField,
} from "@/app/(app)/applications/lib";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
} from "@/app/(app)/applications/workflow";
import { type ReviewSyncMessage, useReviewSync } from "@/components/applications/review-sync";
import { AlertModal } from "@/components/common/alert-modal";
import { fileDownloadUrl } from "@/components/common/file-link";
import { Modal } from "@/components/common/modal";
import { SaveStatus } from "@/components/common/save-status";
import { ScaleButtons } from "@/components/common/scale-buttons";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { LOCALE_CODES, pickText, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import type { Intolerance, Language } from "@/lib/types";
import { cn } from "@/lib/utils";

// The Document Picture-in-Picture API (Chromium-only as of writing) is the
// one real, spec-guaranteed way a page can put its own content in a window
// the OS keeps above everything else. TypeScript's DOM lib doesn't ship
// types for it yet, so it's declared narrowly here — only the bits used
// below — rather than pulling in a whole ambient-types package for one API.
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
    };
  }
}

/** Synthetic section for the shirt-size/dietary fields, that is never stored in
 *  `application.sections`.
 *  Mirrors `applications/[id]/shared.ts` and `my-applications/lib.ts`. */
const LOGISTICS_SECTION_KEY = "__logistics__";
const LOGISTICS_SECTION: FormSection = {
  key: LOGISTICS_SECTION_KEY,
  title: { en: "Logistics", es: "Logística", gl: "Loxística" },
};

/** Fake "fields" for shirt size/dietary data so they render as ordinary answer
 *  rows instead of a hardcoded block. Read-only: this data lives on the user
 *  row, edited from the applicant's profile, not through this form. */
function logisticsAnswerFields(
  askShirtSize: boolean,
  askFoodIntolerances: boolean,
  intolerances: Intolerance[],
): TemplateField[] {
  const fields: TemplateField[] = [];
  if (askShirtSize) {
    fields.push({
      key: "shirt_size",
      label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
      kind: "text",
      required: false,
      section_key: LOGISTICS_SECTION_KEY,
    });
  }
  if (askFoodIntolerances) {
    fields.push(
      {
        key: "food_intolerances",
        label: {
          en: "Dietary restrictions",
          es: "Restricciones dietéticas",
          gl: "Restricións dietéticas",
        },
        kind: "multiselect",
        required: false,
        options: intolerances.map((i) => ({ value: String(i.id), label: i.label })),
        section_key: LOGISTICS_SECTION_KEY,
      },
      {
        key: "food_intolerance_notes",
        label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
        kind: "textarea",
        required: false,
        section_key: LOGISTICS_SECTION_KEY,
      },
    );
  }
  return fields;
}

interface AnswerGroup {
  section: FormSection | null;
  fields: TemplateField[];
}

/** Groups a flat field list under its sections, ungrouped fields leading —
 *  matches the builder's layout. Mirrors the same helper in `applications/[id]/shared.ts`. */
function groupFieldsBySections(fields: TemplateField[], sections: FormSection[]): AnswerGroup[] {
  const knownKeys = new Set(sections.map((s) => s.key));
  const ungrouped = fields.filter((f) => !f.section_key || !knownKeys.has(f.section_key));
  const groups: AnswerGroup[] = [{ section: null, fields: ungrouped }];
  for (const section of sections) {
    groups.push({ section, fields: fields.filter((f) => f.section_key === section.key) });
  }
  return groups.filter((g) => g.fields.length > 0);
}

/** Renders one field's value as plain text for the answers export — mirrors
 *  TemplateFieldControl's read-only display for kinds with an option lookup. */
function fieldValueText(
  field: TemplateField,
  value: unknown,
  lang: Language,
  t: Translate,
): string {
  if (value == null || value === "") return "";
  switch (field.kind) {
    case "select": {
      const opt = field.options?.find((o) => o.value === value);
      return opt ? pickText(opt.label, lang) : String(value);
    }
    case "multiselect": {
      const values = Array.isArray(value) ? value : [];
      return values
        .map((v) => {
          const opt = field.options?.find((o) => o.value === v);
          return opt ? pickText(opt.label, lang) : String(v);
        })
        .join(", ");
    }
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Quotes a CSV field only when it needs it (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Downloads every answer for one applicant as a CSV file (section, field,
 *  value), grouped the same way the read-only view shows them. */
function exportAnswers(
  response: ResponseRow,
  answerFields: TemplateField[],
  answerSections: FormSection[],
  answerValues: Record<string, unknown>,
  lang: Language,
  t: Translate,
) {
  const rows: string[][] = [
    ["Section", "Field", "Value"],
    ["", "Name", response.name ?? ""],
    ["", "Email", response.email],
  ];
  for (const group of groupFieldsBySections(answerFields, answerSections)) {
    const sectionTitle = group.section ? pickText(group.section.title, lang) : "";
    for (const field of group.fields) {
      const text = fieldValueText(field, answerValues[field.key], lang, t);
      rows.push([sectionTitle, pickText(field.label, lang), text]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(response.name ?? response.email).replace(/[^a-z0-9]+/gi, "-")}-answers.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

interface ApplicationFile {
  fieldKey: string;
  label: string;
  value: string | null;
  filename: string;
  href: string | null;
  preview: "image" | "pdf" | "download" | "empty";
}

type FileViewerSide = "left" | "right";
const FILE_VIEWER_SIDE_STORAGE_KEY = "hackos.application-review.file-viewer-side";
const FILE_VIEWER_DRAG_TYPE = "text/hackos-application-file-viewer";
const FLOATING_REVIEW_POSITION_STORAGE_KEY = "hackos.application-review.floating-review-position";
const REVIEW_TOASTER_ID = "application-review-modal";

function fileNameFromValue(value: string): string {
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname;
    } catch {
      // Keep the raw value as a best-effort filename for malformed URLs.
    }
  }
  const segment = path.split("/").filter(Boolean).pop() ?? path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function applicationFilePreview(filename: string): ApplicationFile["preview"] {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "pdf";
  if (["gif", "jpeg", "jpg", "png", "webp"].includes(extension ?? "")) return "image";
  return "download";
}

function applicationFiles(
  fields: TemplateField[],
  values: Record<string, unknown>,
  lang: Language,
): ApplicationFile[] {
  return fields.flatMap((field): ApplicationFile[] => {
    if (field.kind !== "file") return [];
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) {
      return [
        {
          fieldKey: field.key,
          label: pickText(field.label, lang),
          value: null,
          filename: "",
          href: null,
          preview: "empty" as const,
        },
      ];
    }
    const filename = fileNameFromValue(value);
    return [
      {
        fieldKey: field.key,
        label: pickText(field.label, lang),
        value,
        filename,
        href: fileDownloadUrl(value),
        preview: applicationFilePreview(filename),
      },
    ];
  });
}

/** Minimum pointer travel before the grip's fallback drag engages — small
 *  enough to feel immediate, large enough not to swallow a plain click. */
const GRIP_DRAG_THRESHOLD_PX = 6;

function ApplicationFileViewer({
  files,
  activeIndex,
  side,
  onIndexChange,
  onSideChange,
  onDragStart,
  onDragEnd,
  onPointerDragStart,
  onPointerDragEnd,
  className,
}: {
  files: ApplicationFile[];
  activeIndex: number;
  side: FileViewerSide;
  onIndexChange: (index: number) => void;
  onSideChange: (side: FileViewerSide) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  /** Pointer-based fallback for browsers/contexts where native HTML5 drag
   *  doesn't engage reliably on the detached (floating) panel — mirrors
   *  onDragStart/onDrop but driven by pointer capture instead of dataTransfer. */
  onPointerDragStart?: () => void;
  onPointerDragEnd?: (clientX: number, clientY: number) => void;
  className?: string;
}) {
  const { t } = useLocale();
  const previewRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const gripDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    native: boolean;
    active: boolean;
  } | null>(null);
  // A completed pointer-fallback drag still fires a trailing click on the
  // same button — suppress just that one so it doesn't also toggle the side.
  const suppressGripClickRef = useRef(false);

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

  // Native dragstart takes over the input stream (the browser fires
  // pointercancel for the pointer that started it), so mark the in-flight
  // pointer sequence as native and let the real onDragStart run — no double
  // side-change from both paths firing for the same gesture.
  function handleGripDragStart(event: DragEvent<HTMLButtonElement>) {
    if (gripDragRef.current) gripDragRef.current.native = true;
    onDragStart(event);
  }

  function handleGripPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    gripDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      native: false,
      active: false,
    };
  }

  function handleGripPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gripDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.native || drag.active) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) < GRIP_DRAG_THRESHOLD_PX) return;
    drag.active = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onPointerDragStart?.();
  }

  function handleGripPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = gripDragRef.current;
    gripDragRef.current = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.active && !drag.native) {
      suppressGripClickRef.current = true;
      onPointerDragEnd?.(event.clientX, event.clientY);
    }
  }

  function handleGripPointerCancel() {
    gripDragRef.current = null;
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
                <ExternalLinkIcon />
              </a>
              <button
                type="button"
                className={dialogIconButtonClass}
                onClick={() => void toggleFullscreen()}
                aria-label={t(isFullscreen ? "exitFullscreenFile" : "fullscreenFile")}
                aria-pressed={isFullscreen}
                title={t(isFullscreen ? "exitFullscreenFile" : "fullscreenFile")}
              >
                {isFullscreen ? <Minimize2Icon /> : <Maximize2Icon />}
              </button>
            </>
          )}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            draggable
            onDragStart={handleGripDragStart}
            onDragEnd={onDragEnd}
            onPointerDown={handleGripPointerDown}
            onPointerMove={handleGripPointerMove}
            onPointerUp={handleGripPointerUp}
            onPointerCancel={handleGripPointerCancel}
            onClick={() => {
              if (suppressGripClickRef.current) {
                suppressGripClickRef.current = false;
                return;
              }
              onSideChange(nextSide);
            }}
            className="hidden cursor-grab touch-none px-1.5 active:cursor-grabbing lg:inline-flex"
            aria-label={t("moveFileViewer", {
              side: t(nextSide === "left" ? "leftSide" : "rightSide"),
            })}
            title={t("moveFileViewer", {
              side: t(nextSide === "left" ? "leftSide" : "rightSide"),
            })}
          >
            <GripVerticalIcon />
            <span className="sr-only">{t("moveFileViewerHint")}</span>
          </Button>
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
                <ChevronLeftIcon />
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
                <ChevronRightIcon />
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

function ApplicationFileViewerPanel({
  files,
  activeIndex,
  side,
  dragging,
  onIndexChange,
  onSideChange,
  onDragStart,
  onDragEnd,
  onPointerDragStart,
  onPointerDragEnd,
  onDragOver,
  onDrop,
  reviewContent,
}: {
  files: ApplicationFile[];
  activeIndex: number;
  side: FileViewerSide;
  /** True while the viewer's grip is mid-drag, anywhere in the modal — used
   *  to show this docked panel as a valid drop target (H: docked viewer+review). */
  dragging?: boolean;
  onIndexChange: (index: number) => void;
  onSideChange: (side: FileViewerSide) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onPointerDragStart?: () => void;
  onPointerDragEnd?: (clientX: number, clientY: number) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  reviewContent?: React.ReactNode;
}) {
  const { t } = useLocale();
  const panelOffset = "calc(50% + 13.5rem)";
  return (
    <aside
      data-dialog-floating
      data-file-viewer-dropzone={side === "left" ? "right" : "left"}
      className={cn(
        "pointer-events-auto fixed z-[60] hidden h-[min(90vh,54rem)] w-[min(30rem,calc(100vw-2rem))] 2xl:grid 2xl:gap-4",
        reviewContent ? "2xl:grid-rows-[minmax(0,1fr)_auto]" : "2xl:grid-rows-[minmax(0,1fr)]",
        dragging && "2xl:rounded-xl 2xl:ring-2 2xl:ring-primary/50 2xl:ring-offset-2",
      )}
      style={{
        ...(side === "left" ? { right: panelOffset } : { left: panelOffset }),
        top: "50%",
        transform: "translateY(-50%)",
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={dragging ? t("dropFileViewerHere") : t("applicationFilesLabel")}
    >
      <div className="min-h-0 rounded-xl">
        <ApplicationFileViewer
          files={files}
          activeIndex={activeIndex}
          side={side}
          onIndexChange={onIndexChange}
          onSideChange={onSideChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onPointerDragStart={onPointerDragStart}
          onPointerDragEnd={onPointerDragEnd}
          className="h-full"
        />
      </div>
      {reviewContent && <div className="min-h-0 rounded-xl">{reviewContent}</div>}
    </aside>
  );
}

function FileViewerDropZones({
  onDragOver,
  onDrop,
  onSideChange,
}: {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (side: FileViewerSide, event: DragEvent<HTMLElement>) => void;
  onSideChange: (side: FileViewerSide) => void;
}) {
  const { t } = useLocale();
  const sides: FileViewerSide[] = ["left", "right"];

  return (
    <div
      data-dialog-floating
      className="pointer-events-none fixed inset-0 z-[80] hidden items-center justify-between px-4 2xl:flex"
    >
      {sides.map((side) => (
        <button
          key={side}
          type="button"
          data-dialog-floating
          data-file-viewer-dropzone={side}
          className="border-primary/60 bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-ring pointer-events-auto flex h-[min(54vh,32rem)] w-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 text-center text-xs font-medium shadow-lg backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
          onDragOver={onDragOver}
          onDrop={(event) => onDrop(side, event)}
          onClick={() => onSideChange(side)}
          aria-label={t("moveFileViewer", {
            side: t(side === "left" ? "leftSide" : "rightSide"),
          })}
          title={t("moveFileViewer", {
            side: t(side === "left" ? "leftSide" : "rightSide"),
          })}
        >
          <GripVerticalIcon className="size-5" aria-hidden="true" />
          <span>{t("dropFileViewerHere")}</span>
        </button>
      ))}
    </div>
  );
}

/** Average score, review reveal, and status pills for the active response. */
function StatusPillsRow({
  response,
  st,
  reviewedByMe,
  t,
  canRevealReviews,
  onShowReviews,
  className,
}: {
  response: ResponseRow;
  st: string;
  reviewedByMe: boolean;
  t: Translate;
  canRevealReviews: boolean;
  onShowReviews: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-control border border-border bg-muted/20 px-1.5 py-1">
        <p className="text-muted-foreground min-w-0 flex-1 px-1 text-xs">
          avg {fmtScore(response.avg_score)}/5 · {response.review_count}{" "}
          {response.review_count === 1 ? t("reviewWord") : t("reviewsWord")}
        </p>
        {canRevealReviews && response.review_count > 0 && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="shrink-0 px-2"
            onClick={onShowReviews}
          >
            {t("viewReviews", { count: response.review_count })}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 sm:ms-auto">
        <StatusBadge tone={statusTone(st)}>{applicationStatusLabel(st, t)}</StatusBadge>
        {reviewedByMe && (
          <StatusBadge tone="success" dot={false}>
            <CircleCheckIcon className="size-3" aria-hidden="true" />
            {t("reviewedByYou")}
          </StatusBadge>
        )}
      </div>
    </div>
  );
}

export function ReviewModal({
  response,
  applicationId,
  template,
  sections = [],
  askShirtSize = false,
  askFoodIntolerances = false,
  onClose,
  onChanged,
  onNavigate,
  onDecisionStatusChange,
  canGoPrev = false,
  canGoNext = false,
}: {
  response: ResponseRow;
  applicationId: number;
  template: TemplateField[] | null;
  /** The form's named sections (H11), so answers group the same way the
   *  builder and applicant form do. */
  sections?: FormSection[];
  /** Whether this form asks for shirt size/dietary data (H12) — see `logisticsAnswerFields`. */
  askShirtSize?: boolean;
  askFoodIntolerances?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  workspace?: ApplicationWorkspace;
  /** Keeps the modal's familiar navigation set stable while a decision is made. */
  onDecisionStatusChange?: (status: ResponseRow["status"]) => void;
  /** Prev/next paging over the caller's currently visible row order — omit
   *  where there's no meaningful list to page through (e.g. a single-user
   *  profile view). */
  onNavigate?: (direction: "prev" | "next") => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
}) {
  const { t } = useLocale();
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canOverride = useCan(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE);
  const canEdit = useCan(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE);
  const canExport = useCan(CAPABILITIES.EXPORTS_RUN);
  const me = useMe();
  const lang = (me?.language ?? "es") as Language;

  const [staffNotes, setStaffNotes] = useState(response.staff_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);

  const hasLogisticsFields = askShirtSize || askFoodIntolerances;
  const logisticsFields = logisticsAnswerFields(askShirtSize, askFoodIntolerances, intolerances);
  const answerFields = [...(template ?? []), ...logisticsFields];
  const answerSections = hasLogisticsFields ? [...sections, LOGISTICS_SECTION] : sections;
  const answerValues: Record<string, unknown> = {
    ...response.responses,
    shirt_size: response.shirt_size,
    food_intolerances: response.food_intolerances?.map(String) ?? [],
    food_intolerance_notes: response.food_intolerance_notes,
  };
  const files = applicationFiles(answerFields, answerValues, lang);

  useEffect(() => {
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((res) => setIntolerances(res.intolerances))
      .catch(() => {});
  }, []);
  // Seeded straight from response.reviews (already returned by both the list
  // and detail endpoints) — no separate fetch needed to hydrate the reviewer's
  // own row on open.
  const myReview = response.reviews.find((review) => review.author_id === me?.id);
  const [myScore, setMyScore] = useState<number | null>(myReview?.score ?? null);
  const [myNotes, setMyNotes] = useState(myReview?.notes ?? "");
  const [reviewSaveState, setReviewSaveState] = useState<SaveState>("saved");
  // Only user-driven edits should trigger an autosave — reseeding on
  // navigation to a different response must not re-PUT an unchanged score.
  const [reviewDirty, setReviewDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // The PUT replaces the whole responses object, so editValues seeds from every
  // existing key, not just the ones the template shows.
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>(response.responses);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [reviewPage, setReviewPage] = useState<"application" | "reviews">("application");
  const [modalStatus, setModalStatus] = useState(response.status);
  const [fileViewerSide, setFileViewerSide] = useState<FileViewerSide>("left");
  const [fileViewerDragging, setFileViewerDragging] = useState(false);
  const [desktopFloating, setDesktopFloating] = useState(false);
  const reviewWindowRef = useRef<Window | null>(null);
  const reviewDraftRef = useRef({
    responseId: response.id,
    score: myReview?.score ?? null,
    notes: myReview?.notes ?? "",
    dirty: false,
  });
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const closeReviewWindowRef = useRef<() => void>(undefined);
  closeReviewWindowRef.current = function closeReviewWindow() {
    const existingWindow = reviewWindowRef.current;
    reviewWindowRef.current = null;
    if (existingWindow && !existingWindow.closed) existingWindow.close();
  };

  // Refocusing this tab means the reviewer no longer needs the popup escape
  // hatch; closing the modal (the "evaluation profile") means there's nothing
  // left for the popup to review either way.
  useEffect(() => {
    function handleFocus() {
      if (document.visibilityState === "visible") closeReviewWindowRef.current?.();
    }
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, []);

  useEffect(() => () => closeReviewWindowRef.current?.(), []);

  useEffect(() => {
    const savedSide = window.localStorage.getItem(FILE_VIEWER_SIDE_STORAGE_KEY);
    if (savedSide === "left" || savedSide === "right") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a persisted UI preference after client mount
      setFileViewerSide(savedSide);
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktopFloating(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const navigate = onNavigate;
    if (!navigate) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='menu'][data-state='open']",
        )
      ) {
        return;
      }

      const direction = event.key === "ArrowLeft" ? "prev" : "next";
      const canNavigate = direction === "prev" ? canGoPrev : canGoNext;
      if (!canNavigate) return;

      event.preventDefault();
      navigate?.(direction);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [canGoNext, canGoPrev, onNavigate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed on navigating to a different response/user, not on every response.reviews identity change (e.g. after this same reviewer's own autosave).
  useEffect(() => {
    const mine = response.reviews.find((review) => review.author_id === me?.id);
    const pendingDraft = reviewDraftRef.current;
    if (pendingDraft.responseId !== response.id && pendingDraft.dirty && canReview) {
      void api.put(`/api/responses/${pendingDraft.responseId}/my-review`, {
        score: pendingDraft.score,
        notes: pendingDraft.notes.trim() || null,
      });
    }
    reviewDraftRef.current = {
      responseId: response.id,
      score: mine?.score ?? null,
      notes: mine?.notes ?? "",
      dirty: false,
    };
    setMyScore(mine?.score ?? null);
    setMyNotes(mine?.notes ?? "");
    setReviewSaveState("saved");
    setReviewDirty(false);
    setModalStatus(response.status);
    setStaffNotes(response.staff_notes ?? "");
    setEditValues({ ...response.responses });
    setEditing(false);
    setActiveFileIndex(0);
    setReviewPage("application");
  }, [response.id, me?.id, canReview]);

  useEffect(
    () => () => {
      const pendingDraft = reviewDraftRef.current;
      if (!pendingDraft.dirty || !canReview) return;
      void api.put(`/api/responses/${pendingDraft.responseId}/my-review`, {
        score: pendingDraft.score,
        notes: pendingDraft.notes.trim() || null,
      });
    },
    [canReview],
  );

  function handleScoreChange(v: number | null) {
    reviewDraftRef.current = {
      responseId: response.id,
      score: v,
      notes: myNotes,
      dirty: true,
    };
    setMyScore(v);
    setReviewDirty(true);
    setReviewSaveState("saving");
  }
  function handleNotesChange(v: string) {
    reviewDraftRef.current = {
      responseId: response.id,
      score: myScore,
      notes: v,
      dirty: true,
    };
    setMyNotes(v);
    setReviewDirty(true);
    setReviewSaveState("saving");
  }

  function updateModalStatus(status: ResponseRow["status"]) {
    setModalStatus(status);
    onDecisionStatusChange?.(status);
  }

  function changeFileViewerSide(side: FileViewerSide) {
    setFileViewerSide(side);
    window.localStorage.setItem(FILE_VIEWER_SIDE_STORAGE_KEY, side);
  }

  function handleFileViewerDragStart(event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FILE_VIEWER_DRAG_TYPE, "file-viewer");
    setFileViewerDragging(true);
  }

  function handleFileViewerDragEnd() {
    setFileViewerDragging(false);
  }

  function handleFileViewerDragOver(event: DragEvent<HTMLElement>) {
    if (!fileViewerDragging) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleFileViewerDrop(side: FileViewerSide, event: DragEvent<HTMLElement>) {
    if (!fileViewerDragging) return;
    event.preventDefault();
    changeFileViewerSide(side);
    setFileViewerDragging(false);
  }

  function handleFileViewerPointerDragStart() {
    setFileViewerDragging(true);
  }

  /** Pointer-fallback counterpart to handleFileViewerDrop — hit-tests the
   *  release point instead of relying on dataTransfer/dragover. */
  function handleFileViewerPointerDragEnd(clientX: number, clientY: number) {
    setFileViewerDragging(false);
    const target = document.elementFromPoint(clientX, clientY);
    const zone =
      target instanceof Element ? target.closest<HTMLElement>("[data-file-viewer-dropzone]") : null;
    const side = zone?.dataset.fileViewerDropzone;
    if (side === "left" || side === "right") changeFileViewerSide(side);
  }

  useEffect(() => {
    // During candidate navigation the response prop changes before the seed
    // effect below has replaced the local composer state. Do not briefly save
    // the previous candidate's draft into the newly selected response.
    if (!reviewDirty || !canReview || reviewDraftRef.current.responseId !== response.id) {
      return;
    }
    const handle = window.setTimeout(async () => {
      setReviewSaveState("saving");
      try {
        await api.put(`/api/responses/${response.id}/my-review`, {
          score: myScore,
          notes: myNotes.trim() || null,
        });
        if (reviewDraftRef.current.responseId === response.id) {
          reviewDraftRef.current.dirty = false;
        }
        setReviewSaveState("saved");
        setReviewDirty(false);
      } catch {
        setReviewSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [response.id, myScore, myNotes, reviewDirty, canReview]);

  // Mirrors score/notes/save-state to a same-origin popup opened via
  // openReviewWindow (H: docked review composer popup). The popup does its
  // own autosave independently — this tab only reflects what it broadcasts,
  // never re-saves on its behalf, so the two never race to PUT the same row.
  useReviewSync(
    applicationId,
    {
      responseId: response.id,
      score: myScore,
      notes: myNotes,
      saveState: reviewSaveState,
      status: modalStatus,
    },
    (message: ReviewSyncMessage) => {
      if (message.responseId !== response.id) return;
      if (reviewDirty) return;
      setMyScore(message.score);
      setMyNotes(message.notes);
      setReviewSaveState(message.saveState);
    },
  );

  function startEdit() {
    setEditValues({ ...response.responses });
    setEditing(true);
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      // PUT /api/responses/:id (APPLICATIONS_EDIT_RESPONSE) — audited server-side.
      await api.put(`/api/responses/${response.id}`, { responses: editValues });
      await onChanged();
      setEditing(false);
      toast.success(t("answersUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveAnswers"));
    } finally {
      setSavingEdit(false);
    }
  }

  /** Runs a decision action, keeps the modal open, and optionally refreshes the parent. */
  async function run(label: string, fn: () => Promise<unknown>, options: RunOptions = {}) {
    setBusy(true);
    try {
      await fn();
      if (options.nextStatus) updateModalStatus(options.nextStatus);
      if (options.refresh !== false) await onChanged();
      if (options.notify) options.notify();
      else toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveStaffNotes() {
    setSavingNotes(true);
    try {
      // PATCH /api/responses/:id/staff-notes (APPLICATIONS_REVIEW) — shared notes.
      await api.patch(`/api/responses/${response.id}/staff-notes`, {
        staff_notes: staffNotes.trim() || null,
      });
      await onChanged();
      toast.success(t("staffNotesSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveNotes"));
    } finally {
      setSavingNotes(false);
    }
  }

  const st = modalStatus;
  // A draft hasn't been submitted yet, so there's nothing for a reviewer to score.
  const canScore = canReview && st !== "draft";
  const reviewedByMe = response.reviews.some(
    (review) => review.author_id === me?.id && review.score != null,
  );
  const activeFile = Math.min(activeFileIndex, Math.max(files.length - 1, 0));
  const canRevealReviews = canManage;
  const showDecisionMenu = hasDecisionActions(canDecide);
  const showEditAction = canEdit && Boolean(template?.length);
  const showExportAction = canExport && answerFields.length > 0;

  // Opens *only* the review composer (score + notes), not the application
  // shell — the popup is a companion to this modal, not a second copy of it.
  // Real-time sync back to this tab is over BroadcastChannel (useReviewSync
  // below); both windows load the same minimal route so they share one
  // implementation of the composer instead of two.
  async function openReviewWindow() {
    const existingWindow = reviewWindowRef.current;
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      return;
    }
    reviewWindowRef.current = null;
    const url = new URL(
      `/review-popup/${response.id}?applicationId=${applicationId}`,
      window.location.origin,
    ).toString();
    // Document Picture-in-Picture is the only web-platform API that lets a
    // page's own window be kept above other windows by the browser/OS — a
    // real guarantee, not a request a page can spoof. It's Chromium-only and
    // requires a user gesture, so this is a best-effort upgrade: browsers
    // without it (Firefox, Safari) fall through to an ordinary popup, which
    // has no scripted way to stay on top — no API lets a web page force
    // that, by design, for the user's own security.
    if (window.documentPictureInPicture) {
      try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({
          width: 420,
          height: 620,
        });
        const iframe = pipWindow.document.createElement("iframe");
        iframe.src = url;
        iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;";
        pipWindow.document.body.style.margin = "0";
        pipWindow.document.title = response.name ?? response.email;
        pipWindow.document.body.append(iframe);
        reviewWindowRef.current = pipWindow;
        return;
      } catch {
        // Denied (no user gesture in this call stack, one already open,
        // etc.) — fall through to the plain popup below.
      }
    }
    const popup = window.open(
      url,
      `hackos-review-window-${applicationId}`,
      "popup=yes,width=420,height=620,resizable=yes,scrollbars=yes",
    );
    // A single, immediate focus on open — not a repeated/refocus loop, which
    // would steal focus back from whatever the reviewer clicks into next.
    if (popup) {
      reviewWindowRef.current = popup;
      popup.focus();
    } else toast.error(t("reviewWindowBlocked"));
  }

  function handleAnswerLinkClick() {
    if (canScore && window.matchMedia("(min-width: 1024px)").matches) {
      void openReviewWindow();
    }
  }

  function showApplicantAcceptedToast() {
    toast.success(t("applicantAccepted"), {
      toasterId: REVIEW_TOASTER_ID,
      duration: 8_000,
      action: {
        label: t("undo"),
        onClick: () => {
          void undoAcceptance();
        },
      },
    });
  }
  async function undoAcceptance() {
    if (mountedRef.current) setBusy(true);
    try {
      await api.post(`/api/responses/${response.id}/revert-decision`, { decision: "review" });
      if (mountedRef.current) updateModalStatus("review");
      toast.success(t("acceptanceUndone"), { toasterId: REVIEW_TOASTER_ID });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("actionFailed"), {
        toasterId: REVIEW_TOASTER_ID,
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const reviewComposerProps: ReviewComposerProps = {
    responseId: response.id,
    myScore,
    onScoreChange: handleScoreChange,
    myNotes,
    onNotesChange: handleNotesChange,
    reviewSaveState,
    onOpenReviewWindow: openReviewWindow,
    dockSide: files.length > 0 ? fileViewerSide : undefined,
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      floatingFocus={desktopFloating && (canScore || files.length > 0)}
      className={cn(
        "max-h-[90vh] sm:max-w-4xl 2xl:h-[min(90vh,54rem)] 2xl:transition-[left]",
        files.length > 0 &&
          (fileViewerSide === "left"
            ? "2xl:left-[calc(50%+15.5rem)]"
            : "2xl:left-[calc(50%-15.5rem)]"),
      )}
      icon={FileTextIcon}
      title={response.name ?? response.email}
      description={response.name ? response.email : undefined}
      headerActions={
        (onNavigate || showDecisionMenu || showEditAction || showExportAction) && (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
            {onNavigate && (
              <>
                <button
                  type="button"
                  className={dialogIconButtonClass}
                  disabled={!canGoPrev}
                  onClick={() => onNavigate("prev")}
                  aria-label={t("previousCandidate")}
                  title={t("previousCandidate")}
                >
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  className={dialogIconButtonClass}
                  disabled={!canGoNext}
                  onClick={() => onNavigate("next")}
                  aria-label={t("nextCandidate")}
                  title={t("nextCandidate")}
                >
                  <ChevronRightIcon />
                </button>
              </>
            )}
            {showDecisionMenu && (
              <DecisionMenu
                status={st}
                busy={busy}
                run={run}
                responseId={response.id}
                canOverride={canOverride}
                onRequestRevoke={() => setConfirmRevoke(true)}
                onAccepted={showApplicantAcceptedToast}
              />
            )}
            {showEditAction &&
              (editing ? (
                <button
                  type="button"
                  className={dialogIconButtonClass}
                  disabled={savingEdit}
                  onClick={() => void saveEdit()}
                  aria-label={t("saveAnswers")}
                  title={t("saveAnswers")}
                >
                  {savingEdit ? <Spinner /> : <SaveIcon />}
                </button>
              ) : (
                <button
                  type="button"
                  className={dialogIconButtonClass}
                  onClick={startEdit}
                  aria-label={t("editAnswers")}
                  title={t("editAnswers")}
                >
                  <PencilIcon />
                </button>
              ))}
            {showExportAction && (
              <button
                type="button"
                className={dialogIconButtonClass}
                onClick={() =>
                  exportAnswers(response, answerFields, answerSections, answerValues, lang, t)
                }
                aria-label={t("exportAnswers")}
                title={t("exportAnswers")}
              >
                <DownloadIcon />
              </button>
            )}
          </div>
        )
      }
      floatingContent={
        <>
          {files.length > 0 && fileViewerDragging && (
            <FileViewerDropZones
              onDragOver={handleFileViewerDragOver}
              onDrop={handleFileViewerDrop}
              onSideChange={changeFileViewerSide}
            />
          )}
          {files.length > 0 && (
            <ApplicationFileViewerPanel
              files={files}
              activeIndex={activeFile}
              side={fileViewerSide}
              dragging={fileViewerDragging}
              onIndexChange={setActiveFileIndex}
              onSideChange={changeFileViewerSide}
              onDragStart={handleFileViewerDragStart}
              onDragEnd={handleFileViewerDragEnd}
              onPointerDragStart={handleFileViewerPointerDragStart}
              onPointerDragEnd={handleFileViewerPointerDragEnd}
              onDragOver={handleFileViewerDragOver}
              onDrop={(event) =>
                handleFileViewerDrop(fileViewerSide === "left" ? "right" : "left", event)
              }
              reviewContent={canScore ? <ReviewPanelCard {...reviewComposerProps} /> : undefined}
            />
          )}
          {canScore && (
            <div className={cn("hidden lg:block", files.length > 0 && "2xl:hidden")}>
              <FloatingReviewPanel {...reviewComposerProps} />
            </div>
          )}
        </>
      }
    >
      <section
        className={cn("space-y-4", fileViewerDragging && "rounded-xl ring-1 ring-primary/30")}
        aria-label={t("applicationFilesLabel")}
        tabIndex={-1}
        data-file-viewer-dropzone={fileViewerSide === "left" ? "right" : "left"}
        onDragOver={handleFileViewerDragOver}
        onDrop={(event) =>
          handleFileViewerDrop(fileViewerSide === "left" ? "right" : "left", event)
        }
      >
        {reviewPage === "reviews" ? (
          <ReviewsPage
            reviews={response.reviews}
            avgScore={response.avg_score}
            reviewCount={response.review_count}
            onBack={() => setReviewPage("application")}
          />
        ) : (
          <>
            <div className="bg-background sticky top-0 z-10 -mx-6 mb-2 px-6 py-2">
              <StatusPillsRow
                response={response}
                st={st}
                reviewedByMe={reviewedByMe}
                t={t}
                canRevealReviews={canRevealReviews}
                onShowReviews={() => setReviewPage("reviews")}
              />
            </div>

            {files.length > 0 && (
              <div className="grid gap-6 2xl:hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <section
                  className={cn(
                    "hidden min-w-0 space-y-4 lg:block lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1",
                    fileViewerSide === "right" && "lg:order-2",
                  )}
                  data-file-viewer-dropzone={fileViewerSide}
                  onDragOver={handleFileViewerDragOver}
                  onDrop={(event) => handleFileViewerDrop(fileViewerSide, event)}
                  aria-label={t("applicationFilesLabel")}
                >
                  <ApplicationFileViewer
                    files={files}
                    activeIndex={activeFile}
                    side={fileViewerSide}
                    onIndexChange={setActiveFileIndex}
                    onSideChange={changeFileViewerSide}
                    onDragStart={handleFileViewerDragStart}
                    onDragEnd={handleFileViewerDragEnd}
                    onPointerDragStart={handleFileViewerPointerDragStart}
                    onPointerDragEnd={handleFileViewerPointerDragEnd}
                  />
                </section>

                <section
                  className={cn(
                    "min-w-0 space-y-4 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1",
                    fileViewerSide === "left" && "lg:order-2",
                    fileViewerDragging &&
                      "lg:rounded-xl lg:border lg:border-dashed lg:border-primary/40 lg:p-3",
                  )}
                  data-file-viewer-dropzone={fileViewerSide === "left" ? "right" : "left"}
                  onDragOver={handleFileViewerDragOver}
                  onDrop={(event) =>
                    handleFileViewerDrop(fileViewerSide === "left" ? "right" : "left", event)
                  }
                  aria-label={fileViewerDragging ? t("dropFileViewerHere") : undefined}
                >
                  {fileViewerDragging && (
                    <p className="hidden rounded-control border border-dashed border-primary/50 px-3 py-2 text-center text-xs text-primary lg:block">
                      {t("dropFileViewerHere")}
                    </p>
                  )}
                  <AnswersSection
                    applicationId={applicationId}
                    editing={editing}
                    setEditing={setEditing}
                    editValues={editValues}
                    setEditValues={setEditValues}
                    savingEdit={savingEdit}
                    saveEdit={saveEdit}
                    answerFields={answerFields}
                    answerSections={answerSections}
                    answerValues={answerValues}
                    response={response}
                    lang={lang}
                    onExternalLinkClick={handleAnswerLinkClick}
                  />
                </section>
              </div>
            )}

            {files.length > 0 ? (
              <div className="hidden 2xl:block">
                <AnswersSection
                  applicationId={applicationId}
                  editing={editing}
                  setEditing={setEditing}
                  editValues={editValues}
                  setEditValues={setEditValues}
                  savingEdit={savingEdit}
                  saveEdit={saveEdit}
                  answerFields={answerFields}
                  answerSections={answerSections}
                  answerValues={answerValues}
                  response={response}
                  lang={lang}
                  onExternalLinkClick={handleAnswerLinkClick}
                />
              </div>
            ) : (
              <AnswersSection
                applicationId={applicationId}
                editing={editing}
                setEditing={setEditing}
                editValues={editValues}
                setEditValues={setEditValues}
                savingEdit={savingEdit}
                saveEdit={saveEdit}
                answerFields={answerFields}
                answerSections={answerSections}
                answerValues={answerValues}
                response={response}
                lang={lang}
                onExternalLinkClick={handleAnswerLinkClick}
              />
            )}

            {canReview && (
              <StaffNotesCard
                staffNotes={staffNotes}
                setStaffNotes={setStaffNotes}
                savingNotes={savingNotes}
                saveStaffNotes={saveStaffNotes}
              />
            )}

            {canScore && (
              <div className="lg:hidden">
                <InlineReviewPanel {...reviewComposerProps} />
              </div>
            )}
          </>
        )}

        <AlertModal
          open={confirmRevoke}
          onOpenChange={setConfirmRevoke}
          title={t("revokeSpot")}
          description={t("revokeSpotWarning")}
          cancelLabel={t("cancel")}
          confirmLabel={t("revokeSpot")}
          destructive
          pending={busy}
          onConfirm={() => {
            void run(t("spotRevoked"), () =>
              api.post(`/api/responses/${response.id}/revoke-spot`),
            ).finally(() => setConfirmRevoke(false));
          }}
        />
        <Toaster id={REVIEW_TOASTER_ID} position="bottom-right" />
      </section>
    </Modal>
  );
}

/** The applicant's answers: read-only grouped-by-section view, an inline
 *  edit form (APPLICATIONS_EDIT_RESPONSE), or a raw key/value fallback when
 *  the form has no template. */
function AnswersSection({
  applicationId,
  editing,
  setEditing,
  editValues,
  setEditValues,
  savingEdit,
  saveEdit,
  answerFields,
  answerSections,
  answerValues,
  response,
  lang,
  onExternalLinkClick,
}: {
  applicationId: number;
  editing: boolean;
  setEditing: (v: boolean) => void;
  editValues: Record<string, unknown>;
  setEditValues: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  savingEdit: boolean;
  saveEdit: () => Promise<void>;
  answerFields: TemplateField[];
  answerSections: FormSection[];
  answerValues: Record<string, unknown>;
  response: ResponseRow;
  lang: Language;
  onExternalLinkClick?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{t("answersLabel")}</p>
      {answerFields.length > 0 ? (
        <div className="space-y-4">
          {groupFieldsBySections(answerFields, answerSections).map((group, i) => (
            <div
              key={group.section?.key ?? `ungrouped-${i}`}
              className={
                group.section
                  ? "border-border bg-muted/20 space-y-4 rounded-xl border p-4 sm:p-5"
                  : "space-y-4"
              }
            >
              {group.section && (
                <p className="type-section-title text-balance">
                  {pickText(group.section.title, lang)}
                </p>
              )}
              <div className="space-y-4">
                {group.fields.map((f) => {
                  const isLogistics = group.section?.key === LOGISTICS_SECTION_KEY;
                  const fieldEditing = editing && !isLogistics;
                  const value = (fieldEditing ? editValues[f.key] : answerValues[f.key]) as
                    | FieldValue
                    | undefined;
                  return (
                    <TemplateFieldControl
                      key={f.key}
                      field={f}
                      applicationId={fieldEditing ? applicationId : undefined}
                      value={value}
                      disabled={!fieldEditing}
                      onChange={(v) => setEditValues((prev) => ({ ...prev, [f.key]: v }))}
                      sharedWithSponsors={
                        (fieldEditing ? editValues : response.responses)[sponsorShareKey(f.key)] ===
                        true
                      }
                      onSharedWithSponsorsChange={(v) =>
                        setEditValues((prev) => ({ ...prev, [sponsorShareKey(f.key)]: v }))
                      }
                      lang={lang}
                      inDialog
                      onExternalLinkClick={onExternalLinkClick}
                    />
                  );
                })}
              </div>
              {group.section?.key === LOGISTICS_SECTION_KEY && (
                <Link
                  href={`/users/${response.user_id}`}
                  className="text-primary text-xs underline underline-offset-4"
                >
                  {t("editInProfileLink")}
                </Link>
              )}
            </div>
          ))}
          {editing && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={savingEdit}
                onClick={() => setEditing(false)}
              >
                {t("cancel")}
              </Button>
              <Button size="sm" disabled={savingEdit} onClick={saveEdit}>
                {savingEdit && <Spinner />}
                {t("saveAnswers")}
              </Button>
            </div>
          )}
        </div>
      ) : Object.keys(response.responses).length > 0 ? (
        <div className="divide-border divide-y">
          {Object.entries(response.responses).map(([k, v]) => (
            <div key={k} className="py-3 first:pt-0 last:pb-0">
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{k}</p>
              <div className="whitespace-pre-wrap text-sm">
                {typeof v === "object" ? JSON.stringify(v) : String(v)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noAnswersRecorded")}</p>
      )}
    </div>
  );
}

function StaffNotesCard({
  staffNotes,
  setStaffNotes,
  savingNotes,
  saveStaffNotes,
}: {
  staffNotes: string;
  setStaffNotes: (v: string) => void;
  savingNotes: boolean;
  saveStaffNotes: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-2">
      <Label htmlFor="review-internal-notes" className="text-sm font-medium">
        {t("internalNotesLabel")}
      </Label>
      <Textarea
        id="review-internal-notes"
        rows={2}
        value={staffNotes}
        onChange={(e) => setStaffNotes(e.target.value)}
        placeholder={t("visibleToAllReviewersPlaceholder")}
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" disabled={savingNotes} onClick={saveStaffNotes}>
          {savingNotes && <Spinner />}
          {t("saveNotes")}
        </Button>
      </div>
    </div>
  );
}

function ReviewsPage({
  reviews,
  avgScore,
  reviewCount,
  onBack,
}: {
  reviews: ReviewEntry[];
  avgScore: number | string | null;
  reviewCount: number;
  onBack: () => void;
}) {
  const { t } = useLocale();
  return (
    <section aria-labelledby="all-reviews-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeftIcon />
            {t("backToApplication")}
          </Button>
          <h3 id="all-reviews-title" className="type-section-title mt-3 text-balance">
            {t("allReviewsTitle")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            avg {fmtScore(avgScore)}/5 · {reviewCount}{" "}
            {reviewCount === 1 ? t("reviewWord") : t("reviewsWord")}
          </p>
        </div>
      </div>
      {reviews.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {reviews.map((review) => (
            <ReviewBubble key={review.author_id} review={review} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noReviewsYet")}</p>
      )}
    </section>
  );
}

function ReviewBubble({ review }: { review: ReviewEntry }) {
  const { t, language } = useLocale();
  return (
    <li className="border-border bg-muted/20 space-y-2 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{review.author_name ?? t("unknownReviewer")}</p>
        <div className="flex items-center gap-2">
          {review.score != null && (
            <StatusBadge tone="neutral" dot={false}>
              {review.score}/5
            </StatusBadge>
          )}
          <span className="text-muted-foreground text-xs">
            {new Intl.DateTimeFormat(LOCALE_CODES[language], { dateStyle: "medium" }).format(
              new Date(review.updated_at),
            )}
          </span>
        </div>
      </div>
      {review.notes && (
        <p className="text-muted-foreground text-sm whitespace-pre-wrap">{review.notes}</p>
      )}
    </li>
  );
}

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

export function ReviewComposerFields({
  responseId,
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
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">{t("scoreRangeLabel")}</Label>
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
          <Label
            htmlFor={`review-notes-${responseId}`}
            className="text-muted-foreground text-xs uppercase"
          >
            {t("notesLabel")}
          </Label>
          <SaveStatus state={reviewSaveState} />
        </div>
        <Textarea
          id={`review-notes-${responseId}`}
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
        "border-primary/30 bg-card space-y-3 rounded-xl border p-4 shadow-2xl ring-1 ring-black/5",
        className,
      )}
    >
      <div className="flex items-center gap-1">
        {dragHandle}
        <p className="min-w-0 flex-1 text-sm font-medium">{t("yourReview")}</p>
        {props.onOpenReviewWindow && (
          <button
            type="button"
            className={dialogIconButtonClass}
            onClick={props.onOpenReviewWindow}
            aria-label={t("openReviewWindow")}
            title={t("openReviewWindow")}
          >
            <ExternalLinkIcon />
          </button>
        )}
      </div>
      <ReviewComposerFields {...props} />
    </div>
  );
}

function FloatingReviewPanel(props: ReviewComposerProps) {
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
    <button
      type="button"
      className={cn(dialogIconButtonClass, "cursor-grab touch-none active:cursor-grabbing")}
      onPointerDown={startDragging}
      onPointerMove={moveDragging}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={moveWithKeyboard}
      aria-label={t("moveReviewPanel")}
      title={t("moveReviewPanel")}
    >
      <GripVerticalIcon />
    </button>
  );

  return (
    <div
      ref={panelRef}
      data-dialog-floating
      className="pointer-events-auto fixed z-[70] w-[min(24rem,calc(100vw-2rem))] rounded-xl"
      style={panelStyle}
    >
      <ReviewPanelCard {...props} dragHandle={dragHandle} />
    </div>
  );
}

function InlineReviewPanel(props: ReviewComposerProps) {
  return <ReviewPanelCard {...props} className="shadow-sm" />;
}

interface RunOptions {
  /** A decision stays in the modal until the reviewer closes it. */
  refresh?: boolean;
  nextStatus?: ResponseRow["status"];
  notify?: () => void;
}

type RunAction = (label: string, fn: () => Promise<unknown>, options?: RunOptions) => Promise<void>;

function hasDecisionActions(canDecide: boolean) {
  // The gavel is deliberately persistent. The available items change with
  // the status, but the control never disappears when an in-modal action
  // moves an application between workspaces.
  return canDecide;
}

/** Admin decisions stay available without competing with the review forum. */
function DecisionMenu({
  status,
  busy,
  run,
  responseId,
  canOverride,
  onRequestRevoke,
  onAccepted,
}: {
  status: ResponseRow["status"];
  busy: boolean;
  run: RunAction;
  responseId: number;
  canOverride: boolean;
  onRequestRevoke: () => void;
  onAccepted: () => void;
}) {
  const { t } = useLocale();
  const reviewActions = status === "review";
  const outboxActions = status === "accepted_internal" || status === "rejected_internal";
  const sentActions = ["accepted", "rejected", "confirmed", "declined", "expired"].includes(status);
  const hasAvailableActions = reviewActions || outboxActions || sentActions;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={dialogIconButtonClass}
          disabled={busy}
          aria-label={t("decisionMenuLabel")}
          title={t("decisionMenuLabel")}
        >
          <GavelIcon />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>{t("decisionLabel")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!hasAvailableActions && (
          <DropdownMenuItem disabled>{t("noDecisionActions")}</DropdownMenuItem>
        )}
        {reviewActions && (
          <>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("acceptedUnsentToast"),
                  () => api.post(`/api/responses/${responseId}/decide`, { decision: "accepted" }),
                  {
                    refresh: false,
                    nextStatus: "accepted_internal",
                    notify: onAccepted,
                  },
                )
              }
            >
              {t("accept")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onSelect={() =>
                void run(
                  t("rejectedUnsentToast"),
                  () => api.post(`/api/responses/${responseId}/decide`, { decision: "rejected" }),
                  { refresh: false, nextStatus: "rejected_internal" },
                )
              }
            >
              {t("reject")}
            </DropdownMenuItem>
          </>
        )}
        {outboxActions && (
          <>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("decisionSent"),
                  () => api.post(`/api/responses/${responseId}/send-decision`),
                  {
                    refresh: false,
                    nextStatus: status === "accepted_internal" ? "accepted" : "rejected",
                  },
                )
              }
            >
              <SendIcon />
              {t("sendDecision")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() =>
                void run(
                  t("movedBackToReview"),
                  () =>
                    api.post(`/api/responses/${responseId}/revert-decision`, {
                      decision: "review",
                    }),
                  { refresh: false, nextStatus: "review" },
                )
              }
            >
              {t("backToReview")}
            </DropdownMenuItem>
          </>
        )}
        {sentActions && (
          <>
            {(status === "accepted" || status === "rejected" || status === "expired") && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  void run(
                    t("decisionResent"),
                    () => api.post(`/api/responses/${responseId}/resend-decision`),
                    { refresh: false, nextStatus: status === "expired" ? "accepted" : status },
                  )
                }
              >
                {t("resend")}
              </DropdownMenuItem>
            )}
            {(status === "accepted" || status === "rejected") && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  void run(
                    t("movedBackToReview"),
                    () =>
                      api.post(`/api/responses/${responseId}/revert-decision`, {
                        decision: "review",
                      }),
                    { refresh: false, nextStatus: "review" },
                  )
                }
              >
                {t("backToReview")}
              </DropdownMenuItem>
            )}
            {(status === "rejected" || status === "declined" || status === "expired") && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  void run(
                    t("reacceptedUnsent"),
                    () => api.post(`/api/responses/${responseId}/re-accept`),
                    { refresh: false, nextStatus: "accepted" },
                  )
                }
              >
                {t("reaccept")}
              </DropdownMenuItem>
            )}
            {(status === "accepted" || status === "confirmed") && (
              <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onRequestRevoke}>
                {t("revokeSpot")}
              </DropdownMenuItem>
            )}
            {canOverride && status === "accepted" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    void run(
                      t("spotConfirmed"),
                      () => api.post(`/api/responses/${responseId}/confirm`),
                      { refresh: false, nextStatus: "confirmed" },
                    )
                  }
                >
                  {t("confirmOverride")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={() =>
                    void run(
                      t("spotDeclined"),
                      () => api.post(`/api/responses/${responseId}/decline`),
                      { refresh: false, nextStatus: "declined" },
                    )
                  }
                >
                  {t("declineOverride")}
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
