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
  PencilIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { type DragEvent, useEffect, useRef, useState } from "react";
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
import { AlertModal } from "@/components/common/alert-modal";
import { FileLink, fileDownloadUrl } from "@/components/common/file-link";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { LOCALE_CODES, pickText, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import type { Intolerance, Language } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  value: string;
  filename: string;
  href: string;
  preview: "image" | "pdf" | "download";
}

type FileViewerSide = "left" | "right";
const FILE_VIEWER_SIDE_STORAGE_KEY = "hackos.application-review.file-viewer-side";
const FILE_VIEWER_DRAG_TYPE = "text/hackos-application-file-viewer";

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
  return fields.flatMap((field) => {
    if (field.kind !== "file") return [];
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) return [];
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

function ApplicationFileViewer({
  files,
  activeIndex,
  side,
  onIndexChange,
  onSideChange,
  onDragStart,
  onDragEnd,
}: {
  files: ApplicationFile[];
  activeIndex: number;
  side: FileViewerSide;
  onIndexChange: (index: number) => void;
  onSideChange: (side: FileViewerSide) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const { t } = useLocale();
  if (files.length === 0) return null;

  const file = files[activeIndex] ?? files[0];
  const fileTitle = `${file.label}: ${file.filename}`;
  const nextSide = side === "left" ? "right" : "left";
  return (
    <section
      aria-labelledby="application-files-title"
      className="border-border bg-muted/20 space-y-3 rounded-xl border p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="application-files-title" className="type-section-title text-balance">
            {t("applicationFilesLabel")}
          </h3>
          <p className="text-muted-foreground mt-1 truncate text-xs" title={fileTitle}>
            {fileTitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={() => onSideChange(nextSide)}
            className="hidden cursor-grab px-1.5 active:cursor-grabbing lg:inline-flex"
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

      <div className="overflow-hidden rounded-control border bg-background">
        {file.preview === "pdf" ? (
          <iframe
            key={file.value}
            src={file.href}
            title={fileTitle}
            className="h-[min(62vh,48rem)] w-full"
          />
        ) : file.preview === "image" ? (
          <div className="flex min-h-64 items-center justify-center bg-muted/10 p-3 sm:p-6">
            {/* biome-ignore lint/performance/noImgElement: private authenticated file proxy cannot be optimized by Next Image */}
            <img
              key={file.value}
              src={file.href}
              alt={fileTitle}
              className="max-h-[62vh] max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
            <FileTextIcon className="text-muted-foreground size-8" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">{t("filePreviewUnavailable")}</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <FileLink value={file.value}>
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          {t("viewFileLabel")}
        </FileLink>
      </div>
    </section>
  );
}

/** Status pills + average score — rendered twice (mobile leads with it,
 *  desktop keeps it atop the right sidebar) via the `className` prop. */
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
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone(st)}>{applicationStatusLabel(st, t)}</StatusBadge>
        {reviewedByMe && (
          <StatusBadge tone="success" dot={false}>
            <CircleCheckIcon className="size-3" aria-hidden="true" />
            {t("reviewedByYou")}
          </StatusBadge>
        )}
        {response.shirt_size && (
          <StatusBadge tone="neutral" dot={false}>
            {t("tshirtSize", { size: response.shirt_size })}
          </StatusBadge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <p className="text-muted-foreground">
          avg {fmtScore(response.avg_score)}/5 · {response.review_count}{" "}
          {response.review_count === 1 ? t("reviewWord") : t("reviewsWord")}
        </p>
        {canRevealReviews && response.review_count > 0 && (
          <Button type="button" size="xs" variant="ghost" onClick={onShowReviews}>
            {t("viewReviews", { count: response.review_count })}
          </Button>
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
  workspace = "review",
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
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const savedSide = window.localStorage.getItem(FILE_VIEWER_SIDE_STORAGE_KEY);
    if (savedSide === "left" || savedSide === "right") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate a persisted UI preference after client mount
      setFileViewerSide(savedSide);
    }
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
  }, [response.id, me?.id]);

  function handleScoreChange(v: number | null) {
    setMyScore(v);
    setReviewDirty(true);
    setReviewSaveState("saving");
  }
  function handleNotesChange(v: string) {
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

  useEffect(() => {
    if (!reviewDirty || !canReview) return;
    const handle = window.setTimeout(async () => {
      setReviewSaveState("saving");
      try {
        await api.put(`/api/responses/${response.id}/my-review`, {
          score: myScore,
          notes: myNotes.trim() || null,
        });
        setReviewSaveState("saved");
        setReviewDirty(false);
      } catch {
        setReviewSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [response.id, myScore, myNotes, reviewDirty, canReview]);

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

  /** Runs a decision action, refreshes the parent, and toasts the result. */
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
  const showDecisionMenu = hasDecisionActions(workspace, st, canDecide);

  function openReviewWindow() {
    const popupWorkspace = workspaceForResponseStatus(st);
    const query = new URLSearchParams({
      tab: popupWorkspace,
      response: String(response.id),
    });
    const popup = window.open(
      `/applications/${applicationId}?${query.toString()}`,
      "hackos-review-window",
      "popup=yes,width=1200,height=900,resizable=yes,scrollbars=yes",
    );
    if (popup) popup.focus();
    else toast.error(t("reviewWindowBlocked"));
  }

  function showApplicantAcceptedToast() {
    toast.success(t("applicantAccepted"), {
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
      toast.success(t("acceptanceUndone"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("actionFailed"));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      className="max-h-[90vh] sm:max-w-7xl"
      icon={FileTextIcon}
      title={response.name ?? response.email}
      description={response.name ? response.email : undefined}
      headerActions={
        (onNavigate || showDecisionMenu) && (
          <div className="flex shrink-0 items-center gap-1">
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
                workspace={workspace}
                status={st}
                busy={busy}
                run={run}
                responseId={response.id}
                canOverride={canOverride}
                onRequestRevoke={() => setConfirmRevoke(true)}
                onAccepted={showApplicantAcceptedToast}
              />
            )}
          </div>
        )
      }
    >
      <div className="space-y-4">
        {reviewPage === "reviews" ? (
          <ReviewsPage
            reviews={response.reviews}
            avgScore={response.avg_score}
            reviewCount={response.review_count}
            onBack={() => setReviewPage("application")}
          />
        ) : (
          <>
            <StatusPillsRow
              response={response}
              st={st}
              reviewedByMe={reviewedByMe}
              t={t}
              canRevealReviews={canRevealReviews}
              onShowReviews={() => setReviewPage("reviews")}
            />

            {files.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <section
                  className={cn(
                    "min-w-0 space-y-4 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1",
                    fileViewerSide === "right" && "lg:order-2",
                  )}
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
                  />
                </section>

                <section
                  className={cn(
                    "min-w-0 space-y-4 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1",
                    fileViewerSide === "left" && "lg:order-2",
                    fileViewerDragging &&
                      "lg:rounded-xl lg:border lg:border-dashed lg:border-primary/40 lg:p-3",
                  )}
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
                    template={template}
                    applicationId={applicationId}
                    canEdit={canEdit}
                    canExport={canExport}
                    editing={editing}
                    setEditing={setEditing}
                    editValues={editValues}
                    setEditValues={setEditValues}
                    savingEdit={savingEdit}
                    startEdit={startEdit}
                    saveEdit={saveEdit}
                    answerFields={answerFields}
                    answerSections={answerSections}
                    answerValues={answerValues}
                    response={response}
                    lang={lang}
                  />
                </section>
              </div>
            ) : (
              <AnswersSection
                template={template}
                applicationId={applicationId}
                canEdit={canEdit}
                canExport={canExport}
                editing={editing}
                setEditing={setEditing}
                editValues={editValues}
                setEditValues={setEditValues}
                savingEdit={savingEdit}
                startEdit={startEdit}
                saveEdit={saveEdit}
                answerFields={answerFields}
                answerSections={answerSections}
                answerValues={answerValues}
                response={response}
                lang={lang}
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
              <MyReviewBubble
                myScore={myScore}
                onScoreChange={handleScoreChange}
                myNotes={myNotes}
                onNotesChange={handleNotesChange}
                reviewSaveState={reviewSaveState}
                onOpenReviewWindow={openReviewWindow}
              />
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
      </div>
    </Modal>
  );
}

/** The applicant's answers: read-only grouped-by-section view, an inline
 *  edit form (APPLICATIONS_EDIT_RESPONSE), or a raw key/value fallback when
 *  the form has no template. */
function AnswersSection({
  template,
  applicationId,
  canEdit,
  canExport,
  editing,
  setEditing,
  editValues,
  setEditValues,
  savingEdit,
  startEdit,
  saveEdit,
  answerFields,
  answerSections,
  answerValues,
  response,
  lang,
}: {
  template: TemplateField[] | null;
  applicationId: number;
  canEdit: boolean;
  canExport: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  editValues: Record<string, unknown>;
  setEditValues: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  savingEdit: boolean;
  startEdit: () => void;
  saveEdit: () => Promise<void>;
  answerFields: TemplateField[];
  answerSections: FormSection[];
  answerValues: Record<string, unknown>;
  response: ResponseRow;
  lang: Language;
}) {
  const { t, language } = useLocale();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("answersLabel")}</p>
        <div className="flex items-center gap-2">
          {canExport && answerFields.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportAnswers(response, answerFields, answerSections, answerValues, language, t)
              }
            >
              <DownloadIcon />
              {t("exportAnswers")}
            </Button>
          )}
          {canEdit && template && template.length > 0 && !editing && (
            <Button size="sm" variant="outline" onClick={startEdit}>
              <PencilIcon />
              {t("editAnswers")}
            </Button>
          )}
        </div>
      </div>
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

function MyReviewBubble({
  myScore,
  onScoreChange,
  myNotes,
  onNotesChange,
  reviewSaveState,
  onOpenReviewWindow,
}: {
  myScore: number | null;
  onScoreChange: (v: number | null) => void;
  myNotes: string;
  onNotesChange: (v: string) => void;
  reviewSaveState: SaveState;
  onOpenReviewWindow?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("yourReview")}</p>
        {onOpenReviewWindow && (
          <button
            type="button"
            className={dialogIconButtonClass}
            onClick={onOpenReviewWindow}
            aria-label={t("openReviewWindow")}
            title={t("openReviewWindow")}
          >
            <ExternalLinkIcon />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">{t("scoreRangeLabel")}</Label>
        <ScaleButtons value={myScore} onChange={onScoreChange} min={0} max={5} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="review-notes" className="text-muted-foreground text-xs uppercase">
            {t("notesLabel")}
          </Label>
          <SaveStatus state={reviewSaveState} />
        </div>
        <Textarea
          id="review-notes"
          rows={3}
          value={myNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder={t("reviewNotesPlaceholder")}
        />
      </div>
    </div>
  );
}

interface RunOptions {
  /** A decision stays in the modal until the reviewer closes it. */
  refresh?: boolean;
  nextStatus?: ResponseRow["status"];
  notify?: () => void;
}

type RunAction = (label: string, fn: () => Promise<unknown>, options?: RunOptions) => Promise<void>;

function workspaceForResponseStatus(status: string): ApplicationWorkspace {
  if (status === "review") return "review";
  if (status === "accepted_internal" || status === "rejected_internal") return "outbox";
  return "sent";
}

function hasDecisionActions(
  workspace: ApplicationWorkspace,
  status: ResponseRow["status"],
  canDecide: boolean,
) {
  if (!canDecide) return false;
  if (workspace === "review") return status === "review";
  if (workspace === "outbox") {
    return status === "accepted_internal" || status === "rejected_internal";
  }
  return ["accepted", "rejected", "confirmed", "declined", "expired"].includes(status);
}

/** Admin decisions stay available without competing with the review forum. */
function DecisionMenu({
  workspace,
  status,
  busy,
  run,
  responseId,
  canOverride,
  onRequestRevoke,
  onAccepted,
}: {
  workspace: ApplicationWorkspace;
  status: ResponseRow["status"];
  busy: boolean;
  run: RunAction;
  responseId: number;
  canOverride: boolean;
  onRequestRevoke: () => void;
  onAccepted: () => void;
}) {
  const { t } = useLocale();
  const reviewActions = workspace === "review" && status === "review";
  const outboxActions =
    workspace === "outbox" && (status === "accepted_internal" || status === "rejected_internal");
  const sentActions = workspace === "sent";

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
