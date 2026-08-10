"use client";

// Review one submitted application response (H13): the answers as an applicant
// gave them, staff/my-review scoring, and — for a decider — the accept/reject
// call. Lives here rather than in applications/[id] because users/[id] opens
// the same modal from a person's profile; a route's page.tsx must not be
// imported by another route.

import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { FileTextIcon, LockIcon, PencilIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type FormSection,
  fmtScore,
  type ResponseRow,
  statusTone,
  type TemplateField,
} from "@/app/(app)/applications/lib";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
} from "@/app/(app)/applications/workflow";
import { AlertModal } from "@/components/common/alert-modal";
import { FileLink } from "@/components/common/file-link";
import { Modal } from "@/components/common/modal";
import { SaveStatus } from "@/components/common/save-status";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { pickText, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import type { Intolerance, Language } from "@/lib/types";

/** Reserved section the shirt-size/dietary fields are grouped under (H11) —
 *  synthetic, never stored in `application.sections`. Mirrors the identically
 *  named constant in `applications/[id]/shared.ts` and `my-applications/lib.ts`
 *  (types/helpers declared locally per module convention). */
const LOGISTICS_SECTION_KEY = "__logistics__";
const LOGISTICS_SECTION: FormSection = {
  key: LOGISTICS_SECTION_KEY,
  title: { en: "Logistics", es: "Logística", gl: "Loxística" },
};

/** The read-only shirt-size/dietary "fields" this modal synthesizes so they
 *  render as ordinary answer rows grouped under Logistics, instead of a
 *  separate hardcoded block. Values come from the response row directly
 *  (H12: this data lives on the user row, not `response.responses`) — editing
 *  it happens on the applicant's profile, not through this form. */
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
 *  matches the builder's own layout. Mirrors the identically-named helper in
 *  `applications/[id]/shared.ts`/`my-applications/lib.ts`. */
function groupFieldsBySections(fields: TemplateField[], sections: FormSection[]): AnswerGroup[] {
  const knownKeys = new Set(sections.map((s) => s.key));
  const ungrouped = fields.filter((f) => !f.section_key || !knownKeys.has(f.section_key));
  const groups: AnswerGroup[] = [{ section: null, fields: ungrouped }];
  for (const section of sections) {
    groups.push({ section, fields: fields.filter((f) => f.section_key === section.key) });
  }
  return groups.filter((g) => g.fields.length > 0);
}

function renderAnswer(
  field: TemplateField,
  value: unknown,
  universities: { id: number; name: string }[],
  lang: Language,
  t: Translate,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value) && value.length === 0) return "—";
  switch (field.kind) {
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    case "select": {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? pickText(opt.label, lang) : String(value);
    }
    case "multiselect": {
      const vals = Array.isArray(value) ? value : [value];
      return vals
        .map((v) => {
          const opt = field.options?.find((o) => o.value === String(v));
          return opt ? pickText(opt.label, lang) : String(v);
        })
        .join(", ");
    }
    case "university": {
      const uni = universities.find((u) => u.id === Number(value));
      return uni ? uni.name : String(value);
    }
    case "date":
      return fmtDate(value);
    default:
      return String(value);
  }
}

/** Format a stored date answer (yyyy-MM-dd, or an ISO datetime) as a plain date. */
function fmtDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  // Anchor a date-only string to UTC noon so the local-timezone render can't
  // roll it to the previous/next day.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Render a response value; file answers become a clickable link so staff (and
 *  anyone with the public URL) can open the uploaded file (H12). */
export function AnswerValue({
  field,
  value,
  universities,
  lang,
  sharedWithSponsors,
}: {
  field: TemplateField;
  value: unknown;
  universities: { id: number; name: string }[];
  lang: Language;
  /** H56: applicant's consent to share this "file" field's upload with sponsors. */
  sharedWithSponsors?: boolean;
}) {
  const { t } = useLocale();
  // A text field validated as a URL is a link the applicant typed: show it
  // clickable so staff can read and click through. A file is a private
  // upload key with no meaningful text, so it stays a generic "View file" link.
  if (field.validation?.text_condition === "url" && typeof value === "string" && value) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all underline underline-offset-4"
      >
        {value}
      </a>
    );
  }
  if (field.kind === "file" && typeof value === "string" && value) {
    return (
      <div className="space-y-1">
        <FileLink value={value} />
        {field.shareable_with_sponsors && (
          <p className="text-muted-foreground text-xs">
            {sharedWithSponsors ? t("shareWithSponsorsStaffYes") : t("shareWithSponsorsStaffNo")}
          </p>
        )}
      </div>
    );
  }
  const rendered = renderAnswer(field, value, universities, lang, t);
  return <span className="whitespace-pre-wrap">{rendered}</span>;
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
}: {
  response: ResponseRow;
  applicationId: number;
  template: TemplateField[] | null;
  /** The form's named sections (H11), so answers group the same way the
   *  builder and applicant form do. */
  sections?: FormSection[];
  /** Whether this form asks for shirt size/dietary data (H12) — shown here
   *  read-only under a synthetic Logistics section; edited on the applicant's
   *  profile, not through this modal (see `logisticsAnswerFields`). */
  askShirtSize?: boolean;
  askFoodIntolerances?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  workspace?: ApplicationWorkspace;
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
  const [universities, setUniversities] = useState<{ id: number; name: string }[]>([]);

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
    // Resolve exactly the university ids this response references (by id, not the
    // alphabetical top-50) so the name always renders instead of the raw id.
    const uniIds = new Set<string>();
    for (const f of template ?? []) {
      if (f.kind !== "university") continue;
      const v = response.responses[f.key];
      if (v != null && v !== "") uniIds.add(String(v));
    }
    if (uniIds.size === 0) return;
    api
      .get<{ universities: { id: number; name: string }[] }>("/api/public/universities", {
        query: { ids: [...uniIds].join(",") },
      })
      .then((res) => setUniversities(res.universities))
      .catch(() => {});
  }, [template, response.responses]);
  // No GET for a reviewer's own row exists — the score/notes inputs are
  // write-only (blank each open); the list column shows the average + count.
  const [myScore, setMyScore] = useState("");
  const [myNotes, setMyNotes] = useState("");
  const [reviewHydrated, setReviewHydrated] = useState(false);
  const [reviewSaveState, setReviewSaveState] = useState<SaveState>("saved");
  const [busy, setBusy] = useState(false);
  // Staff edit of the applicant's answers (APPLICATIONS_EDIT_RESPONSE). Seeded
  // from the current responses; the API replaces the whole object and re-validates
  // against the enriched template, so we send every original key back untouched.
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>(response.responses);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!me?.id || !canReview) return;
    api
      .get<{ reviews: Array<{ author_id: number; score: number | null; notes: string | null }> }>(
        `/api/responses/${response.id}`,
      )
      .then((detail) => {
        const mine = detail.reviews.find((review) => review.author_id === me.id);
        setMyScore(mine?.score == null ? "" : String(mine.score));
        setMyNotes(mine?.notes ?? "");
        setReviewSaveState("saved");
        setReviewHydrated(true);
      })
      .catch(() => {
        setReviewSaveState("error");
        setReviewHydrated(true);
      });
  }, [response.id, me?.id, canReview]);

  useEffect(() => {
    if (!reviewHydrated || !canReview) return;
    const scoreNum = myScore.trim() ? Number(myScore) : null;
    if (scoreNum !== null && (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 100)) {
      setReviewSaveState("error");
      return;
    }
    setReviewSaveState("unsaved");
    const handle = window.setTimeout(async () => {
      setReviewSaveState("saving");
      try {
        await api.put(`/api/responses/${response.id}/my-review`, {
          score: scoreNum,
          notes: myNotes.trim() || null,
        });
        setReviewSaveState("saved");
      } catch {
        setReviewSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [response.id, myScore, myNotes, reviewHydrated, canReview]);

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
  const canScore = canReview && st !== "draft";

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      icon={FileTextIcon}
      title={response.name ?? response.email}
      description={response.email}
    >
      <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={statusTone(st)}>{applicationStatusLabel(st, t)}</StatusBadge>
          <span className="text-muted-foreground text-xs">
            avg {fmtScore(response.avg_score)} · {response.review_count}{" "}
            {response.review_count === 1 ? t("reviewWord") : t("reviewsWord")}
          </span>
          {response.shirt_size && (
            <StatusBadge tone="neutral" dot={false}>
              {t("tshirtSize", { size: response.shirt_size })}
            </StatusBadge>
          )}
        </div>

        {(st === "accepted_internal" || st === "rejected_internal") && (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertTitle>{applicationStatusLabel(st, t)}</AlertTitle>
            <AlertDescription>{t("internalDecisionNotice")}</AlertDescription>
          </Alert>
        )}

        {/* Answers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("answersLabel")}</p>
            {canEdit && template && template.length > 0 && !editing && (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <PencilIcon />
                {t("editAnswers")}
              </Button>
            )}
          </div>
          {editing && template ? (
            <div className="space-y-4">
              {template.map((f) => (
                <TemplateFieldControl
                  key={f.key}
                  field={f}
                  applicationId={applicationId}
                  value={editValues[f.key] as FieldValue}
                  onChange={(v) => setEditValues((prev) => ({ ...prev, [f.key]: v }))}
                  sharedWithSponsors={editValues[sponsorShareKey(f.key)] === true}
                  onSharedWithSponsorsChange={(v) =>
                    setEditValues((prev) => ({ ...prev, [sponsorShareKey(f.key)]: v }))
                  }
                  lang={lang}
                  inDialog
                />
              ))}
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
            </div>
          ) : answerFields.length > 0 ? (
            <div className="space-y-4">
              {groupFieldsBySections(answerFields, answerSections).map((group, i) => (
                <div key={group.section?.key ?? `ungrouped-${i}`} className="space-y-1">
                  {group.section && (
                    <p className="text-muted-foreground text-xs font-semibold uppercase">
                      {pickText(group.section.title, lang)}
                    </p>
                  )}
                  <div className="divide-border divide-y">
                    {group.fields.map((f) => (
                      <div key={f.key} className="py-3 first:pt-0 last:pb-0">
                        <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                          {pickText(f.label, lang) || f.key}
                        </p>
                        <div className="text-sm">
                          <AnswerValue
                            field={f}
                            value={answerValues[f.key]}
                            universities={universities}
                            lang={lang}
                            sharedWithSponsors={response.responses[sponsorShareKey(f.key)] === true}
                          />
                        </div>
                      </div>
                    ))}
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

        {/* Shared staff notes (H13) */}
        {canReview && (
          <div className="space-y-2">
            <Label htmlFor="review-shared-staff-notes" className="text-sm font-medium">
              {t("sharedStaffNotes")}
            </Label>
            <Textarea
              id="review-shared-staff-notes"
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
        )}

        {/* This reviewer's score (H13) */}
        {canScore && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("yourReview")}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{t("reviewAutosaveHint")}</p>
              <SaveStatus state={reviewSaveState} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="review-score" className="text-muted-foreground text-xs uppercase">
                  {t("scoreRangeLabel")}
                </Label>
                <Input
                  id="review-score"
                  type="number"
                  min={0}
                  max={100}
                  value={myScore}
                  onChange={(e) => setMyScore(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-notes" className="text-muted-foreground text-xs uppercase">
                  {t("notesLabel")}
                </Label>
                <Input
                  id="review-notes"
                  value={myNotes}
                  onChange={(e) => setMyNotes(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Decide accept/reject — lives in the review workspace itself now, no
            separate "decisions" tab duplicating this row set (H13/H14). */}
        {workspace === "review" && (st === "review" || st === "submitted") && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("decisionLabel")}</p>
            {canDecide ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(t("acceptedUnsentToast"), () =>
                      api.post(`/api/responses/${response.id}/decide`, { decision: "accepted" }),
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
                      api.post(`/api/responses/${response.id}/decide`, { decision: "rejected" }),
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
        )}

        {/* Decision controls (H14) */}
        {workspace !== "review" && canDecide && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("decisionLabel")}</p>
            <div className="flex flex-wrap gap-2">
              {workspace === "outbox" &&
                (st === "accepted_internal" || st === "rejected_internal") && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(t("decisionSent"), () =>
                          api.post(`/api/responses/${response.id}/send-decision`),
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
                          api.post(`/api/responses/${response.id}/revert-decision`, {
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
                (st === "accepted" || st === "rejected" || st === "expired") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("decisionResent"), () =>
                        api.post(`/api/responses/${response.id}/resend-decision`),
                      )
                    }
                  >
                    {t("resend")}
                  </Button>
                )}
              {workspace === "sent" && (st === "accepted" || st === "rejected") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(t("movedBackToReview"), () =>
                      api.post(`/api/responses/${response.id}/revert-decision`, {
                        decision: "review",
                      }),
                    )
                  }
                >
                  {t("backToReview")}
                </Button>
              )}
              {workspace === "sent" &&
                (st === "rejected" || st === "declined" || st === "expired") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("reacceptedUnsent"), () =>
                        api.post(`/api/responses/${response.id}/re-accept`),
                      )
                    }
                  >
                    {t("reaccept")}
                  </Button>
                )}
              {workspace === "sent" && (st === "accepted" || st === "confirmed") && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmRevoke(true)}
                >
                  {t("revokeSpot")}
                </Button>
              )}
              {workspace === "sent" && canOverride && st === "accepted" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("spotConfirmed"), () =>
                        api.post(`/api/responses/${response.id}/confirm`),
                      )
                    }
                  >
                    {t("confirmOverride")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("spotDeclined"), () =>
                        api.post(`/api/responses/${response.id}/decline`),
                      )
                    }
                  >
                    {t("declineOverride")}
                  </Button>
                </>
              )}
            </div>
          </div>
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
