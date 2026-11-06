"use client";

// Review one submitted application response. Lives here rather than in
// applications/[id] because users/[id] opens the same modal from a person's
// profile, and a route's page.tsx must not be imported by another route.

import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/csr/DotsSixVertical";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GavelIcon } from "@phosphor-icons/react/dist/csr/Gavel";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PencilIcon } from "@phosphor-icons/react/dist/csr/Pencil";
import Link from "next/link";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type ReviewAction, ReviewActions } from "@/components/applications/review-actions";
import {
  FileViewerDocking,
  type FileViewerSide,
} from "@/components/applications/review-file-docking";
import {
  type ApplicationFile,
  ApplicationFileViewer,
  ApplicationFileViewerPanel,
} from "@/components/applications/review-file-viewer";
import { type ReviewSyncMessage, useReviewSync } from "@/components/applications/review-sync";
import { ReviewViewMenu, useReviewView } from "@/components/applications/review-view-menu";
import { AlertModal } from "@/components/common/alert-modal";
import { fileDownloadUrl } from "@/components/common/file-link";
import { Modal } from "@/components/common/modal";
import { SaveStatus } from "@/components/common/save-status";
import { ScaleButtons } from "@/components/common/scale-buttons";
import { StatusBadge } from "@/components/common/status-badge";
import {
  type FieldValue,
  TemplateFieldControl,
  templateFieldId,
} from "@/components/common/template-field-control";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getFoodIntolerances, useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { groupApplicationFields } from "@/lib/application-field-groups";
import {
  fieldErrorsFromApi,
  validateFieldOnBlur,
  validationErrorSummary,
} from "@/lib/application-validation";
import { type ApplicationWorkspace, applicationStatusLabel } from "@/lib/application-workflow";
import {
  type FormSection,
  fmtScore,
  type ResponseRow,
  type ReviewEntry,
  statusTone,
  type TemplateField,
} from "@/lib/applications";
import { LOCALE_CODES, pickText, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
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
 *  Mirrors `lib/application-form.ts` and `my-applications/lib.ts`. */
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

/** H11: reviewer and applicant share the builder's section/question order. */
function groupFieldsBySections(fields: TemplateField[], sections: FormSection[]): AnswerGroup[] {
  return groupApplicationFields(fields, sections);
}

/** Renders one field's value as plain text for the answers export — mirrors
 *  TemplateFieldControl's read-only display for kinds with an option lookup. */
function fieldValueText(
  field: TemplateField,
  value: unknown,
  lang: Language,
  t: Translate,
  libraryValues: {
    universities: Map<number, string>;
    degrees: Map<number, string>;
    intolerances: Map<number, string>;
  },
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
          if (opt) return pickText(opt.label, lang);
          if (field.key === "food_intolerances") {
            return libraryValues.intolerances.get(Number(v)) ?? String(v);
          }
          return String(v);
        })
        .join(", ");
    }
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    case "university":
    case "degree": {
      const id = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(id) || id <= 0) return String(value);
      return (
        (field.kind === "university"
          ? libraryValues.universities.get(id)
          : libraryValues.degrees.get(id)) ?? String(value)
      );
    }
    case "city": {
      if (typeof value !== "object") return String(value);
      const { city, province, country } = value as Record<string, unknown>;
      return [city, province, country]
        .filter((part) => typeof part === "string" && part)
        .join(", ");
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Quotes a CSV field only when it needs it (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Downloads one response as a single wide CSV row, matching the application
 * export and user-roster convention: fields are columns and people are rows. */
function exportAnswers(
  response: ResponseRow,
  answerFields: TemplateField[],
  answerValues: Record<string, unknown>,
  lang: Language,
  t: Translate,
): Promise<void> {
  const idsFor = (kind: "university" | "degree") => [
    ...new Set(
      answerFields.flatMap((field) => {
        if (field.kind !== kind) return [];
        const id = Number(answerValues[field.key]);
        return Number.isInteger(id) && id > 0 ? [id] : [];
      }),
    ),
  ];
  const loadNames = async (path: string, key: "universities" | "degrees", ids: number[]) => {
    if (ids.length === 0) return new Map<number, string>();
    try {
      const response = await api.get<Record<typeof key, Array<{ id: number; name: string }>>>(
        path,
        {
          query: { ids: ids.join(",") },
        },
      );
      return new Map(response[key].map(({ id, name }) => [id, name]));
    } catch {
      return new Map<number, string>();
    }
  };
  return Promise.all([
    loadNames("/api/public/universities", "universities", idsFor("university")),
    loadNames("/api/public/degrees", "degrees", idsFor("degree")),
    getFoodIntolerances()
      .then(
        (intolerances) =>
          new Map(
            intolerances.map((intolerance) => [intolerance.id, pickText(intolerance.label, lang)]),
          ),
      )
      .catch(() => new Map<number, string>()),
  ]).then(([universities, degrees, intolerances]) => {
    const libraryValues = { universities, degrees, intolerances };
    const rows: string[][] = [
      ["Name", "Last name", "Email", ...answerFields.map((field) => pickText(field.label, lang))],
      [
        response.first_name ?? response.name ?? "",
        response.last_name ?? "",
        response.email,
        ...answerFields.map((field) => {
          const value = fieldValueText(field, answerValues[field.key], lang, t, libraryValues);
          return field.key === "food_intolerances"
            ? [value, answerValues.food_intolerance_notes].filter(Boolean).join(", ")
            : value;
        }),
      ],
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(response.name ?? response.email).replace(/[^a-z0-9]+/gi, "-")}-answers.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

const FILE_VIEWER_SIDE_STORAGE_KEY = "hackos.application-review.file-viewer-side";
const FLOATING_REVIEW_POSITION_STORAGE_KEY = "hackos.application-review.floating-review-position";
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

function ReviewStatus({ st, t }: { st: string; t: Translate }) {
  return (
    <StatusBadge tone={statusTone(st)}>
      <span className="truncate">{applicationStatusLabel(st, t)}</span>
    </StatusBadge>
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
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-xs", className)}>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {t("reviewAverageScore", { score: fmtScore(response.avg_score) })}
      </span>
      {reviewedByMe && (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-muted-foreground"
          title={t("reviewedByYou")}
        >
          <CheckCircleIcon className="size-3.5 text-success" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t("reviewedByYou")}</span>
        </span>
      )}
      {canRevealReviews && response.review_count > 0 && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="ms-auto sm:ms-0"
          onClick={onShowReviews}
        >
          {t("viewReviews", { count: response.review_count })}
        </Button>
      )}
      <div className="ms-auto hidden items-center gap-2 sm:flex">
        <ReviewStatus st={st} t={t} />
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
  reviewHiddenFields = [],
  onStandardViewSaved,
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
  /** The form's standard review view: answer keys hidden unless "view all" is on (H13). */
  reviewHiddenFields?: string[];
  onStandardViewSaved?: () => void;
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
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const [staffNotes, setStaffNotes] = useState(response.staff_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const { intolerances } = useFoodIntolerances();

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
  const [viewAll, setViewAll] = useState(false);
  const standardKey = reviewHiddenFields.join("\n");
  const [standardHidden, setStandardHidden] = useState(reviewHiddenFields);
  // biome-ignore lint/correctness/useExhaustiveDependencies: standardKey is the stable identity of reviewHiddenFields
  useEffect(() => setStandardHidden(reviewHiddenFields), [standardKey]);
  const reviewView = useReviewView(applicationId, standardHidden);
  const [savingStandardView, setSavingStandardView] = useState(false);
  // Editing always exposes every answer; the compact view is read-only.
  const compactView = !viewAll && !editing;
  const shownFields = compactView
    ? answerFields.filter((field) => !reviewView.hidden.has(field.key))
    : answerFields;
  const [editValues, setEditValues] = useState<Record<string, unknown>>(response.responses);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [reviewPage, setReviewPage] = useState<"application" | "reviews">("application");
  const [modalStatus, setModalStatus] = useState(response.status);
  const [fileViewerPreviewSide, setFileViewerPreviewSide] = useState<FileViewerSide | null>(null);
  const [fileViewerDragging, setFileViewerDragging] = useState(false);
  const [fileViewerSide, setFileViewerSide] = useState<FileViewerSide>("left");
  const [desktopFloating, setDesktopFloating] = useState(false);
  // Only set true for a popup opened by clicking an answer's external link
  // (see openReviewWindow) — a manual open from the panel's own button leaves
  // the inline composer visible alongside the popup.
  const [inlineReviewHidden, setInlineReviewHidden] = useState(false);
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
    setEditErrors({});
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
        void onChangedRef.current();
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
      if (message.saveState === "saved") void onChangedRef.current();
    },
  );

  async function saveStandardView(hidden: string[]) {
    setSavingStandardView(true);
    try {
      await api.patch(`/api/applications/${applicationId}`, { review_hidden_fields: hidden });
      setStandardHidden(hidden);
      reviewView.setHidden(null);
      toast.success(t("standardReviewViewSaved"), { compactTitle: t("saveStandardReviewView") });
      onStandardViewSaved?.();
    } catch (error) {
      showErrorToast(error, t("saveStandardReviewView"));
    } finally {
      setSavingStandardView(false);
    }
  }

  function startEdit() {
    setEditValues({ ...response.responses });
    setEditErrors({});
    setEditing(true);
  }

  function handleEditFieldChange(key: string, value: FieldValue) {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    setEditErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleEditFieldBlur(field: TemplateField, value: FieldValue) {
    const message = validateFieldOnBlur(field, value, t, lang);
    setEditErrors((previous) => {
      const next = { ...previous };
      if (message) next[field.key] = message;
      else delete next[field.key];
      return next;
    });
  }

  async function saveEdit() {
    const errors: Record<string, string> = {};
    for (const field of answerFields) {
      if (field.section_key === LOGISTICS_SECTION_KEY) continue;
      const message = validateFieldOnBlur(field, editValues[field.key], t, lang);
      if (message) errors[field.key] = message;
    }
    setEditErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(templateFieldId(Object.keys(errors)[0], applicationId))?.focus();
      return;
    }
    setSavingEdit(true);
    try {
      // PUT /api/responses/:id (APPLICATIONS_EDIT_RESPONSE) — audited server-side.
      await api.put(`/api/responses/${response.id}`, { responses: editValues });
      await onChanged();
      setEditing(false);
      toast.success(t("answersUpdated"), { compactTitle: t("saveAnswers") });
    } catch (err) {
      const nextErrors = fieldErrorsFromApi(err, t, answerFields, lang);
      setEditErrors(nextErrors);
      const firstInvalid = answerFields.find((field) => nextErrors[field.key]);
      if (firstInvalid) {
        requestAnimationFrame(() => {
          document.getElementById(templateFieldId(firstInvalid.key, applicationId))?.focus();
        });
      }
      const summary = validationErrorSummary(nextErrors, answerFields, lang);
      const serverMessage = apiErrorText(err, t, "");
      showErrorToast(err, t("couldNotSaveAnswers"), {
        ...(summary || serverMessage
          ? {
              description: [serverMessage, summary].filter(Boolean).join("\n"),
              ...(summary ? { duration: 12_000, autopilot: { expand: 0, collapse: 0 } } : {}),
            }
          : undefined),
        compactTitle: t("saveAnswers"),
      });
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
      else toast.success(label, { compactTitle: t("toastDecisions") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("actionFailed")), t("toastDecisions"));
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
      toast.success(t("staffNotesSaved"), { compactTitle: t("saveNotes") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotSaveNotes")), t("saveNotes"));
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
  const candidateNavigation = onNavigate ? (
    <>
      <button
        type="button"
        className={dialogIconButtonClass}
        disabled={!canGoPrev}
        onClick={() => onNavigate("prev")}
        aria-label={t("previousCandidate")}
        title={t("previousCandidate")}
      >
        <CaretLeftIcon aria-hidden="true" />
      </button>
      <button
        type="button"
        className={dialogIconButtonClass}
        disabled={!canGoNext}
        onClick={() => onNavigate("next")}
        aria-label={t("nextCandidate")}
        title={t("nextCandidate")}
      >
        <CaretRightIcon aria-hidden="true" />
      </button>
    </>
  ) : null;
  const showDecisionMenu = hasDecisionActions(canDecide);
  const showEditAction = canEdit && Boolean(template?.length);
  const showExportAction = canExport && answerFields.length > 0;
  const copyResponseLink = () => {
    const tab =
      response.status === "review"
        ? "review"
        : response.status.endsWith("_internal")
          ? "outbox"
          : "sent";
    const url = new URL(`/applications/${applicationId}`, window.location.origin);
    url.searchParams.set("tab", tab);
    url.searchParams.set("response", String(response.id));
    void navigator.clipboard.writeText(url.href).then(
      () => toast.success(t("copied")),
      () => toast.error(t("couldNotCopyResponseLink")),
    );
  };
  const decisionMenu = showDecisionMenu ? (
    <DecisionMenu
      status={st}
      busy={busy}
      run={run}
      responseId={response.id}
      canOverride={canOverride}
      onRequestRevoke={() => setConfirmRevoke(true)}
      onAccepted={showApplicantAcceptedToast}
    />
  ) : undefined;
  const mobileActions: ReviewAction[] = [
    ...(showEditAction
      ? [
          {
            id: "edit",
            label: editing ? t("saveAnswers") : t("editAnswers"),
            icon: editing ? FloppyDiskIcon : PencilIcon,
            disabled: savingEdit,
            run: () => {
              if (editing) void saveEdit();
              else startEdit();
            },
          },
        ]
      : []),
    { id: "copy", label: t("copyResponseLink"), icon: LinkIcon, run: copyResponseLink },
    ...(showExportAction
      ? [
          {
            id: "export",
            label: t("exportAnswers"),
            icon: DownloadSimpleIcon,
            run: () => {
              void exportAnswers(response, answerFields, answerValues, lang, t);
            },
          },
        ]
      : []),
  ];
  // Suppressed only while a link-opened popup owns the composer (see
  // openReviewWindow) — a manually opened one leaves this visible too.
  const showInlineReview = canScore && !inlineReviewHidden;

  // Opens *only* the review composer (score + notes), not the application
  // shell — the popup is a companion to this modal, not a second copy of it.
  // Real-time sync back to this tab is over BroadcastChannel (useReviewSync
  // below); both windows load the same minimal route so they share one
  // implementation of the composer instead of two.
  //
  // `hideInline` distinguishes why the window opened: clicking an answer's
  // external link is a navigation away from the review task, so the in-modal
  // composer steps aside for the popup; clicking the panel's own external-link
  // button is a deliberate "also open this externally" action and must not
  // remove the composer the reviewer was just looking at. The inline panel
  // comes back on its own once the popup/PiP window actually closes.
  async function openReviewWindow(options: { hideInline?: boolean } = {}) {
    const existingWindow = reviewWindowRef.current;
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      if (options.hideInline) setInlineReviewHidden(true);
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
        pipWindow.addEventListener("pagehide", () => setInlineReviewHidden(false));
        if (options.hideInline) setInlineReviewHidden(true);
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
      popup.addEventListener("unload", () => setInlineReviewHidden(false));
      if (options.hideInline) setInlineReviewHidden(true);
    } else toast.error(t("reviewWindowBlocked"), t("toastOpenReview"));
  }

  function handleAnswerLinkClick() {
    if (canScore && window.matchMedia("(min-width: 1024px)").matches) {
      void openReviewWindow({ hideInline: true });
    }
  }

  function showApplicantAcceptedToast() {
    toast.action(t("applicantAccepted"), {
      compactTitle: t("toastAcceptApplicant"),
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
      toast.success(t("acceptanceUndone"), { compactTitle: t("toastUndoAcceptance") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("actionFailed")), t("toastUndoAcceptance"));
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
    onOpenReviewWindow: () => void openReviewWindow(),
    dockSide: files.length > 0 ? fileViewerSide : undefined,
  };

  const effectiveViewerSide = fileViewerPreviewSide ?? fileViewerSide;

  return (
    <FileViewerDocking
      side={fileViewerSide}
      onSideChange={changeFileViewerSide}
      onDraggingChange={setFileViewerDragging}
      onPreviewSideChange={setFileViewerPreviewSide}
      overlay={
        files.length > 0 ? (
          <div
            className={cn(
              "grid h-full gap-4",
              showInlineReview ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]",
            )}
          >
            <ApplicationFileViewer
              files={files}
              activeIndex={activeFile}
              side={fileViewerSide}
              onIndexChange={setActiveFileIndex}
              onSideChange={changeFileViewerSide}
              className="h-full"
            />
            {showInlineReview && <ReviewPanelCard {...reviewComposerProps} />}
          </div>
        ) : undefined
      }
    >
      <Modal
        open
        onOpenChange={(o) => !o && !fileViewerDragging && onClose()}
        size="xl"
        floatingFocus={desktopFloating && (canScore || files.length > 0)}
        className={cn(
          "max-h-[calc(100dvh-2rem)] gap-3 overflow-visible sm:max-h-[90dvh] sm:max-w-4xl 2xl:h-[min(90vh,54rem)] 2xl:transition-[left] motion-reduce:transition-none",
          files.length > 0 &&
            (effectiveViewerSide === "left"
              ? "2xl:left-[calc(50%+15.5rem)]"
              : "2xl:left-[calc(50%-15.5rem)]"),
        )}
        icon={FileTextIcon}
        title={response.name ?? response.email}
        description={response.name ? response.email : undefined}
        headerNavigation={candidateNavigation}
        headerActions={
          <>
            <div className="hidden items-center gap-1 sm:flex sm:flex-wrap sm:justify-end">
              <button
                type="button"
                className={cn(dialogIconButtonClass, "hidden sm:inline-flex")}
                aria-label={t("copyResponseLink")}
                title={t("copyResponseLink")}
                onClick={copyResponseLink}
              >
                <LinkIcon aria-hidden="true" />
              </button>
              {onNavigate && (
                <div className="hidden items-center gap-1 sm:flex">{candidateNavigation}</div>
              )}
              {decisionMenu}
              <button
                type="button"
                className={dialogIconButtonClass}
                onClick={() => setViewAll((current) => !current)}
                aria-pressed={viewAll || editing}
                disabled={editing}
                aria-label={t("viewAllDetails")}
                title={t("viewAllDetails")}
              >
                {viewAll || editing ? (
                  <EyeIcon aria-hidden="true" weight="fill" />
                ) : (
                  <EyeSlashIcon aria-hidden="true" />
                )}
              </button>
              {!editing && (
                <ReviewViewMenu
                  groups={groupFieldsBySections(answerFields, answerSections)}
                  hidden={reviewView.hidden}
                  customized={reviewView.customized}
                  lang={lang}
                  onChange={reviewView.setHidden}
                  onSaveStandard={canManage ? saveStandardView : undefined}
                  savingStandard={savingStandardView}
                />
              )}
              {showEditAction &&
                (editing ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className={dialogIconButtonClass}
                    loading={savingEdit}
                    onClick={() => void saveEdit()}
                    aria-label={t("saveAnswers")}
                    title={t("saveAnswers")}
                  >
                    <FloppyDiskIcon aria-hidden="true" />
                  </Button>
                ) : (
                  <button
                    type="button"
                    className={dialogIconButtonClass}
                    onClick={startEdit}
                    aria-label={t("editAnswers")}
                    title={t("editAnswers")}
                  >
                    <PencilIcon aria-hidden="true" />
                  </button>
                ))}
              {showExportAction && (
                <button
                  type="button"
                  className={cn(dialogIconButtonClass, "hidden sm:inline-flex")}
                  onClick={() => void exportAnswers(response, answerFields, answerValues, lang, t)}
                  aria-label={t("exportAnswers")}
                  title={t("exportAnswers")}
                >
                  <DownloadSimpleIcon aria-hidden="true" />
                </button>
              )}
            </div>
            <ReviewActions
              primary={decisionMenu}
              actions={mobileActions}
              trailing={<ReviewStatus st={st} t={t} />}
            />
          </>
        }
        floatingContent={
          <>
            {files.length > 0 && (
              <ApplicationFileViewerPanel
                files={files}
                activeIndex={activeFile}
                side={fileViewerSide}
                onIndexChange={setActiveFileIndex}
                onSideChange={changeFileViewerSide}
                reviewContent={
                  showInlineReview ? <ReviewPanelCard {...reviewComposerProps} /> : undefined
                }
              />
            )}
            {showInlineReview && (
              <div className={cn("hidden lg:block", files.length > 0 && "2xl:hidden")}>
                <FloatingReviewPanel {...reviewComposerProps} />
              </div>
            )}
          </>
        }
      >
        <section className="space-y-4" aria-label={t("applicationFilesLabel")} tabIndex={-1}>
          {reviewPage === "reviews" ? (
            <ReviewsPage
              reviews={response.reviews}
              avgScore={response.avg_score}
              reviewCount={response.review_count}
              onBack={() => setReviewPage("application")}
            />
          ) : (
            <>
              <div className="border-border border-b pb-3">
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
                    aria-label={t("applicationFilesLabel")}
                  >
                    <ApplicationFileViewer
                      files={files}
                      activeIndex={activeFile}
                      side={fileViewerSide}
                      onIndexChange={setActiveFileIndex}
                      onSideChange={changeFileViewerSide}
                    />
                  </section>

                  <section
                    className={cn(
                      "min-w-0 space-y-4 lg:max-h-[68vh] lg:overflow-y-auto lg:pr-1",
                      fileViewerSide === "left" && "lg:order-2",
                    )}
                  >
                    <AnswersSection
                      applicationId={applicationId}
                      editing={editing}
                      setEditing={setEditing}
                      editValues={editValues}
                      setEditValues={setEditValues}
                      editErrors={editErrors}
                      onEditFieldChange={handleEditFieldChange}
                      onEditFieldBlur={handleEditFieldBlur}
                      savingEdit={savingEdit}
                      saveEdit={saveEdit}
                      answerFields={shownFields}
                      compactView={compactView}
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
                    editErrors={editErrors}
                    onEditFieldChange={handleEditFieldChange}
                    onEditFieldBlur={handleEditFieldBlur}
                    savingEdit={savingEdit}
                    saveEdit={saveEdit}
                    answerFields={shownFields}
                    compactView={compactView}
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
                  editErrors={editErrors}
                  onEditFieldChange={handleEditFieldChange}
                  onEditFieldBlur={handleEditFieldBlur}
                  savingEdit={savingEdit}
                  saveEdit={saveEdit}
                  answerFields={shownFields}
                  compactView={compactView}
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

              {showInlineReview && (
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
        </section>
      </Modal>
    </FileViewerDocking>
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
  editErrors,
  onEditFieldChange,
  onEditFieldBlur,
  savingEdit,
  saveEdit,
  answerFields,
  compactView,
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
  editErrors: Record<string, string>;
  onEditFieldChange: (key: string, value: FieldValue) => void;
  onEditFieldBlur: (field: TemplateField, value: FieldValue) => void;
  savingEdit: boolean;
  saveEdit: () => Promise<void>;
  answerFields: TemplateField[];
  /** Read-only summary view: birth years read as ages. */
  compactView: boolean;
  answerSections: FormSection[];
  answerValues: Record<string, unknown>;
  response: ResponseRow;
  lang: Language;
  onExternalLinkClick?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      {answerSections.length === 0 && <h3 className="text-sm font-medium">{t("answersLabel")}</h3>}
      {answerFields.length > 0 ? (
        <div className="space-y-4">
          {groupFieldsBySections(answerFields, answerSections)
            .filter((group) => group.fields.length > 0)
            .map((group, i) => (
              <div
                key={group.section?.key ?? `ungrouped-${i}`}
                className={
                  group.section
                    ? "border-border space-y-4 border-t pt-5 first:border-t-0 first:pt-0"
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
                    const birthYear = value as unknown;
                    if (compactView && f.kind === "birth_year" && typeof birthYear === "number") {
                      return (
                        <div key={f.key} className="space-y-1.5">
                          <Label htmlFor={`review-age-${f.key}`}>{t("reviewAgeLabel")}</Label>
                          <Input
                            id={`review-age-${f.key}`}
                            disabled
                            value={t("reviewAgeYears", {
                              count: Math.max(0, new Date().getFullYear() - birthYear),
                            })}
                          />
                        </div>
                      );
                    }
                    return (
                      <TemplateFieldControl
                        key={f.key}
                        field={f}
                        hideHelpText
                        applicationId={fieldEditing ? applicationId : undefined}
                        responseId={fieldEditing ? response.id : undefined}
                        value={value}
                        disabled={!fieldEditing}
                        error={fieldEditing ? editErrors[f.key] : undefined}
                        onChange={(v) => onEditFieldChange(f.key, v)}
                        onBlur={(value) => onEditFieldBlur(f, value)}
                        sharedWithSponsors={
                          (fieldEditing ? editValues : response.responses)[
                            sponsorShareKey(f.key)
                          ] === true
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
              <Button size="sm" disabled={savingEdit} onClick={saveEdit} loading={savingEdit}>
                {t("saveAnswers")}
              </Button>
            </div>
          )}
        </div>
      ) : Object.keys(response.responses).length > 0 ? (
        <div className="divide-border divide-y">
          {Object.entries(response.responses).map(([k, v]) => (
            <div key={k} className="py-3 first:pt-0 last:pb-0">
              <p className="text-muted-foreground mb-1 text-xs font-medium">{k}</p>
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
        <Button
          size="sm"
          variant="outline"
          disabled={savingNotes}
          onClick={saveStaffNotes}
          loading={savingNotes}
        >
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
            <ArrowLeftIcon aria-hidden="true" />
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
        "border-border bg-popover space-y-3 rounded-xl border p-4 shadow-floating",
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
            <ArrowSquareOutIcon aria-hidden="true" />
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
      className={cn(
        dialogIconButtonClass,
        "button-static cursor-grab touch-none active:cursor-grabbing",
      )}
      onPointerDown={startDragging}
      onPointerMove={moveDragging}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={moveWithKeyboard}
      aria-label={t("moveReviewPanel")}
      title={t("moveReviewPanel")}
    >
      <DotsSixVerticalIcon aria-hidden="true" />
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
  return (
    <ReviewPanelCard {...props} className="rounded-none border-0 border-t px-0 pt-5 shadow-none" />
  );
}

interface RunOptions {
  /** A decision stays in the modal until the reviewer closes it. */
  refresh?: boolean;
  nextStatus?: ResponseRow["status"];
  notify?: () => void;
}

type RunAction = (label: string, fn: () => Promise<unknown>, options?: RunOptions) => Promise<void>;

function hasDecisionActions(canDecide: boolean) {
  // Decision controls stay available. Their items change with
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

  const items = (
    <>
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
            <PaperPlaneTiltIcon aria-hidden="true" />
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
      {status !== "draft" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={busy}>
              <FileTextIcon aria-hidden="true" />
              {t("returnToDraft")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              align="start"
              className="w-72 max-w-[calc(100vw-2rem)]"
              style={{ direction: "ltr" }}
            >
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: false,
                        auto_accept_on_resubmit: false,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftOpen")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: true,
                        auto_accept_on_resubmit: false,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftLate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-normal leading-snug"
                onSelect={() =>
                  void run(
                    t("returnedToDraft"),
                    () =>
                      api.post(`/api/responses/${responseId}/return-to-draft`, {
                        allow_resubmit_after_close: true,
                        auto_accept_on_resubmit: true,
                      }),
                    { refresh: false, nextStatus: "draft" },
                  )
                }
              >
                {t("returnToDraftAutoAccept")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
                  t("reaccepted"),
                  () => api.post(`/api/responses/${responseId}/re-accept`, undefined),
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
    </>
  );
  // H12/H14: keep the submenu and its chevron on the same (trailing) side of
  // the decision menu. Radix flips it automatically when the viewport is tight.
  return (
    <DropdownMenu dir="ltr">
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={dialogIconButtonClass}
          disabled={busy}
          aria-label={t("decisionMenuLabel")}
          title={t("decisionMenuLabel")}
        >
          <GavelIcon aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" style={{ direction: "ltr" }}>
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
