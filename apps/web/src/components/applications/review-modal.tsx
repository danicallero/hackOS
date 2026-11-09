"use client";

// Review one submitted application response. Lives here rather than in
// applications/[id] because users/[id] opens the same modal from a person's
// profile, and a route's page.tsx must not be imported by another route.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { PencilIcon } from "@phosphor-icons/react/dist/csr/Pencil";
import { useEffect, useRef, useState } from "react";
import { exportAnswers } from "@/components/applications/answers-export";
import {
  AnswersSection,
  RejectionReasonCard,
  ReviewsPage,
  StaffNotesCard,
} from "@/components/applications/answers-section";
import { applicationFiles } from "@/components/applications/application-files";
import { DecisionMenu, type RunOptions } from "@/components/applications/decision-menu";
import { type ReviewAction, ReviewActions } from "@/components/applications/review-actions";
import {
  FloatingReviewPanel,
  InlineReviewPanel,
  type ReviewComposerProps,
  ReviewPanelCard,
} from "@/components/applications/review-composer";
import {
  FileViewerDocking,
  type FileViewerSide,
} from "@/components/applications/review-file-docking";
import {
  ApplicationFileViewer,
  ApplicationFileViewerPanel,
} from "@/components/applications/review-file-viewer";
import { type ReviewSyncMessage, useReviewSync } from "@/components/applications/review-sync";
import { ReviewViewMenu, useReviewView } from "@/components/applications/review-view-menu";
import { useReviewAutosave } from "@/components/applications/use-review-autosave";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { type FieldValue, templateFieldId } from "@/components/common/template-field-control";
import { Button } from "@/components/ui/button";
import { dialogIconButtonClass } from "@/components/ui/dialog";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { groupApplicationFields } from "@/lib/application-field-groups";
import {
  LOGISTICS_SECTION_KEY,
  logisticsPreviewFields,
  withLogisticsSection,
} from "@/lib/application-form";
import {
  fieldErrorsFromApi,
  validateFieldOnBlur,
  validationErrorSummary,
} from "@/lib/application-validation";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
  applicationStatusTone,
} from "@/lib/application-workflow";
import {
  type FormSection,
  fmtScore,
  type ResponseRow,
  type TemplateField,
} from "@/lib/applications";
import { openCompanionWindow } from "@/lib/companion-window";
import { type Translate, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { showErrorToast, toast } from "@/lib/toast";
import type { Intolerance, Language } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILE_VIEWER_SIDE_STORAGE_KEY = "hackos.application-review.file-viewer-side";

/** Shirt size/dietary data as read-only answer rows: it lives on the user row
 *  and is edited from the applicant's profile, so the shirt size shows as the
 *  stored text rather than the applicant form's size picker. */
function reviewLogisticsFields(
  askShirtSize: boolean,
  askFoodIntolerances: boolean,
  intolerances: Intolerance[],
): TemplateField[] {
  return logisticsPreviewFields(askShirtSize, askFoodIntolerances, intolerances, []).map((field) =>
    field.key === "shirt_size"
      ? { ...field, kind: "text", required: false, options: undefined }
      : field,
  );
}

function ReviewStatus({ st, t }: { st: string; t: Translate }) {
  return (
    <StatusBadge tone={applicationStatusTone(st)}>
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
  /** Whether this form asks for shirt size/dietary data (H12) — see `reviewLogisticsFields`. */
  askShirtSize?: boolean;
  askFoodIntolerances?: boolean;
  /** The form's standard review view: answer keys hidden unless "view all" is on (H13). */
  reviewHiddenFields?: string[];
  onStandardViewSaved?: () => void;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
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
  const answerFields = [
    ...(template ?? []),
    ...reviewLogisticsFields(askShirtSize, askFoodIntolerances, intolerances),
  ];
  const answerSections = withLogisticsSection(sections, hasLogisticsFields);
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
  const reviewDraft = useReviewAutosave(
    response.id,
    canReview,
    { score: myReview?.score ?? null, notes: myReview?.notes ?? "" },
    () => void onChangedRef.current(),
  );
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
  const [rejectionReason, setRejectionReason] = useState(response.rejection_reason ?? null);
  const [savingReason, setSavingReason] = useState(false);
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
    reviewDraft.seed(response.id, { score: mine?.score ?? null, notes: mine?.notes ?? "" });
    setModalStatus(response.status);
    setStaffNotes(response.staff_notes ?? "");
    setRejectionReason(response.rejection_reason ?? null);
    setEditValues({ ...response.responses });
    setEditErrors({});
    setEditing(false);
    setActiveFileIndex(0);
    setReviewPage("application");
  }, [response.id, me?.id, canReview]);

  function updateModalStatus(status: ResponseRow["status"]) {
    setModalStatus(status);
    onDecisionStatusChange?.(status);
  }

  function changeFileViewerSide(side: FileViewerSide) {
    setFileViewerSide(side);
    window.localStorage.setItem(FILE_VIEWER_SIDE_STORAGE_KEY, side);
  }

  // Mirrors score/notes/save-state to a same-origin popup opened via
  // openReviewWindow (H: docked review composer popup). The popup does its
  // own autosave independently — this tab only reflects what it broadcasts,
  // never re-saves on its behalf, so the two never race to PUT the same row.
  useReviewSync(
    applicationId,
    reviewDraft.responseId === response.id
      ? {
          responseId: response.id,
          score: reviewDraft.score,
          notes: reviewDraft.notes,
          saveState: reviewDraft.saveState,
          status: modalStatus,
        }
      : null,
    (message: ReviewSyncMessage) => {
      if (message.responseId !== response.id) return;
      if (reviewDraft.applyRemote(message) && message.saveState === "saved") {
        void onChangedRef.current();
      }
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

  async function saveRejectionReason(value: string) {
    setSavingReason(true);
    try {
      const reason = value.trim() || null;
      await api.patch(`/api/responses/${response.id}/rejection-reason`, { reason });
      setRejectionReason(reason);
      await onChanged();
      toast.success(t("rejectionReasonSaved"), { compactTitle: t("toastDecisions") });
    } catch (err) {
      toast.error(apiErrorText(err, t, t("actionFailed")), t("toastDecisions"));
    } finally {
      setSavingReason(false);
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
  const decisionMenu = canDecide ? (
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
    const opened = await openCompanionWindow({
      url,
      title: response.name ?? response.email,
      name: `hackos-review-window-${applicationId}`,
      width: 420,
      height: 620,
      onClosed: () => setInlineReviewHidden(false),
    });
    if (opened) {
      reviewWindowRef.current = opened;
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
    myScore: reviewDraft.score,
    onScoreChange: reviewDraft.setScore,
    myNotes: reviewDraft.notes,
    onNotesChange: reviewDraft.setNotes,
    reviewSaveState: reviewDraft.saveState,
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
                  groups={groupApplicationFields(answerFields, answerSections)}
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

              {(st === "rejected_internal" || st === "rejected") &&
                (rejectionReason || (canDecide && st === "rejected_internal")) && (
                  <RejectionReasonCard
                    reason={rejectionReason ?? ""}
                    editable={canDecide && st === "rejected_internal"}
                    language={response.user_language}
                    saving={savingReason}
                    onSave={saveRejectionReason}
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
