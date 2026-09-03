"use client";

// Review one submitted application response. Lives here rather than in
// applications/[id] because users/[id] opens the same modal from a person's
// profile, and a route's page.tsx must not be imported by another route.

import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  FileTextIcon,
  LockIcon,
  PencilIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { Modal } from "@/components/common/modal";
import { SaveStatus } from "@/components/common/save-status";
import { ScaleButtons } from "@/components/common/scale-buttons";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { LOCALE_CODES, pickText, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import type { Intolerance, Language } from "@/lib/types";

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
  /** Prev/next paging over the caller's currently visible row order — omit
   *  where there's no meaningful list to page through (e.g. a single-user
   *  profile view). */
  onNavigate?: (direction: "prev" | "next") => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
}) {
  const { t } = useLocale();
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canOverride = useCan(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE);
  const canEdit = useCan(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed on navigating to a different response/user, not on every response.reviews identity change (e.g. after this same reviewer's own autosave).
  useEffect(() => {
    const mine = response.reviews.find((review) => review.author_id === me?.id);
    setMyScore(mine?.score ?? null);
    setMyNotes(mine?.notes ?? "");
    setReviewSaveState("saved");
    setReviewDirty(false);
  }, [response.id, me?.id]);

  function handleScoreChange(v: number | null) {
    setMyScore(v);
    setReviewDirty(true);
    setReviewSaveState("unsaved");
  }
  function handleNotesChange(v: string) {
    setMyNotes(v);
    setReviewDirty(true);
    setReviewSaveState("unsaved");
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
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast.success(label);
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

  const st = response.status;
  // A draft hasn't been submitted yet, so there's nothing for a reviewer to score.
  const canScore = canReview && st !== "draft";
  const reviewedByMe = response.reviews.some(
    (review) => review.author_id === me?.id && review.score != null,
  );
  const otherReviews = response.reviews.filter((review) => review.author_id !== me?.id);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      className="sm:max-w-6xl"
      icon={FileTextIcon}
      title={response.name ?? response.email}
      description={response.name ? response.email : undefined}
    >
      <div className="space-y-4">
        {onNavigate && (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={!canGoPrev}
              onClick={() => onNavigate("prev")}
              aria-label={t("previousCandidate")}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={!canGoNext}
              onClick={() => onNavigate("next")}
              aria-label={t("nextCandidate")}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}

        {(st === "accepted_internal" || st === "rejected_internal") && (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertTitle>{applicationStatusLabel(st, t)}</AlertTitle>
            <AlertDescription>{t("internalDecisionNotice")}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="max-h-[65vh] min-w-0 overflow-y-auto pr-1">
            <AnswersSection
              template={template}
              applicationId={applicationId}
              canEdit={canEdit}
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
          </div>

          <div className="max-h-[65vh] min-w-0 space-y-4 overflow-y-auto pr-1">
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
            <p className="text-muted-foreground text-xs">
              avg {fmtScore(response.avg_score)} · {response.review_count}{" "}
              {response.review_count === 1 ? t("reviewWord") : t("reviewsWord")}
            </p>

            {canReview && (
              <StaffNotesCard
                staffNotes={staffNotes}
                setStaffNotes={setStaffNotes}
                savingNotes={savingNotes}
                saveStaffNotes={saveStaffNotes}
              />
            )}

            {canScore && (
              <MyReviewCard
                myScore={myScore}
                onScoreChange={handleScoreChange}
                myNotes={myNotes}
                onNotesChange={handleNotesChange}
                reviewSaveState={reviewSaveState}
              />
            )}

            {otherReviews.length > 0 && <ReviewWall reviews={otherReviews} />}

            {/* Accept/reject inline here (H13/H14) — no separate "decisions" tab. */}
            {workspace === "review" && st === "review" && (
              <ReviewDecisionCard
                canDecide={canDecide}
                busy={busy}
                run={run}
                responseId={response.id}
              />
            )}

            {/* Elsewhere, status + workspace (outbox/sent) picks the buttons (H14). */}
            {workspace !== "review" && canDecide && (
              <LifecycleDecisionCard
                workspace={workspace}
                status={st}
                busy={busy}
                run={run}
                responseId={response.id}
                canOverride={canOverride}
                onRequestRevoke={() => setConfirmRevoke(true)}
              />
            )}
          </div>
        </div>

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
  const { t } = useLocale();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("answersLabel")}</p>
        {canEdit && template && template.length > 0 && !editing && (
          <Button size="sm" variant="outline" onClick={startEdit}>
            <PencilIcon />
            {t("editAnswers")}
          </Button>
        )}
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

function MyReviewCard({
  myScore,
  onScoreChange,
  myNotes,
  onNotesChange,
  reviewSaveState,
}: {
  myScore: number | null;
  onScoreChange: (v: number | null) => void;
  myNotes: string;
  onNotesChange: (v: string) => void;
  reviewSaveState: SaveState;
}) {
  const { t } = useLocale();
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t("yourReview")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{t("reviewAutosaveHint")}</p>
        <SaveStatus state={reviewSaveState} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">{t("scoreRangeLabel")}</Label>
        <ScaleButtons value={myScore} onChange={onScoreChange} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="review-notes" className="text-muted-foreground text-xs uppercase">
          {t("notesLabel")}
        </Label>
        <Input id="review-notes" value={myNotes} onChange={(e) => onNotesChange(e.target.value)} />
      </div>
    </div>
  );
}

/** Every OTHER evaluator's score/notes for this response, feed-style (H13) —
 *  the caller's own review renders separately via `MyReviewCard`. */
function ReviewWall({ reviews }: { reviews: ReviewEntry[] }) {
  const { t, language } = useLocale();
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("otherReviewsLabel")}</p>
      <ul className="divide-border divide-y">
        {reviews.map((review) => (
          <li key={review.author_id} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{review.author_name ?? t("unknownReviewer")}</p>
              <div className="flex items-center gap-2">
                {review.score != null && (
                  <StatusBadge tone="neutral" dot={false}>
                    {review.score}/10
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
        ))}
      </ul>
    </div>
  );
}

type RunAction = (label: string, fn: () => Promise<unknown>) => Promise<void>;

/** Inline accept/reject in the review workspace itself (H13/H14) — no separate
 *  "decisions" tab duplicating this row set. */
function ReviewDecisionCard({
  canDecide,
  busy,
  run,
  responseId,
}: {
  canDecide: boolean;
  busy: boolean;
  run: RunAction;
  responseId: number;
}) {
  const { t } = useLocale();
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t("decisionLabel")}</p>
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              run(t("acceptedUnsentToast"), () =>
                api.post(`/api/responses/${responseId}/decide`, { decision: "accepted" }),
              )
            }
          >
            {t("accept")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() =>
              run(t("rejectedUnsentToast"), () =>
                api.post(`/api/responses/${responseId}/decide`, { decision: "rejected" }),
              )
            }
          >
            {t("reject")}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{t("needDecideCapability")}</p>
      )}
    </div>
  );
}

/** Decision controls (H14) outside the review workspace — buttons here depend
 *  on which of outbox/sent the row is in, not just its status. */
function LifecycleDecisionCard({
  workspace,
  status,
  busy,
  run,
  responseId,
  canOverride,
  onRequestRevoke,
}: {
  workspace: ApplicationWorkspace;
  status: ResponseRow["status"];
  busy: boolean;
  run: RunAction;
  responseId: number;
  canOverride: boolean;
  onRequestRevoke: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="border-border space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">{t("decisionLabel")}</p>
      <div className="flex flex-wrap gap-2">
        {workspace === "outbox" &&
          (status === "accepted_internal" || status === "rejected_internal") && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(t("decisionSent"), () =>
                    api.post(`/api/responses/${responseId}/send-decision`),
                  )
                }
              >
                <SendIcon />
                {t("sendDecision")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(t("movedBackToReview"), () =>
                    api.post(`/api/responses/${responseId}/revert-decision`, {
                      decision: "review",
                    }),
                  )
                }
              >
                {t("backToReview")}
              </Button>
            </>
          )}
        {workspace === "sent" &&
          (status === "accepted" || status === "rejected" || status === "expired") && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(t("decisionResent"), () =>
                  api.post(`/api/responses/${responseId}/resend-decision`),
                )
              }
            >
              {t("resend")}
            </Button>
          )}
        {workspace === "sent" && (status === "accepted" || status === "rejected") && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(t("movedBackToReview"), () =>
                api.post(`/api/responses/${responseId}/revert-decision`, { decision: "review" }),
              )
            }
          >
            {t("backToReview")}
          </Button>
        )}
        {workspace === "sent" &&
          (status === "rejected" || status === "declined" || status === "expired") && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(t("reacceptedUnsent"), () => api.post(`/api/responses/${responseId}/re-accept`))
              }
            >
              {t("reaccept")}
            </Button>
          )}
        {workspace === "sent" && (status === "accepted" || status === "confirmed") && (
          <Button size="sm" variant="destructive" disabled={busy} onClick={onRequestRevoke}>
            {t("revokeSpot")}
          </Button>
        )}
        {workspace === "sent" && canOverride && status === "accepted" && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(t("spotConfirmed"), () => api.post(`/api/responses/${responseId}/confirm`))
              }
            >
              {t("confirmOverride")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(t("spotDeclined"), () => api.post(`/api/responses/${responseId}/decline`))
              }
            >
              {t("declineOverride")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
