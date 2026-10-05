"use client";

// Collaborative evaluation form (H36): field-level last-write-wins saves,
// conflict reconciliation, judge presence and offline handling. The rules it
// shares with the reviews-overview detail live in lib/attempt-review.ts.

import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/csr/WifiSlash";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { type Answers, normalizeAnswers, QuestionField } from "@/components/common/question-field";
import { ReviewStatusBadge } from "@/components/common/review-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEventSource } from "@/hooks/use-event-source";
import { changedFieldLabel, requiredUnanswered } from "@/lib/attempt-review";
import { useLocale } from "@/lib/i18n";
import { collaborationState } from "@/lib/judging-workspace";
import {
  type AttemptReviewVersion,
  acquireReviewFieldLease,
  closeSession,
  getReview,
  getReviewFieldLeases,
  getReviewVersions,
  getSessions,
  type JudgingSession,
  openSession,
  type QueueEntry,
  type ReviewFieldLease,
  releaseReviewFieldLease,
  saveReview,
} from "@/lib/queue";
import { toast } from "@/lib/toast";
import type { Challenge } from "../challenges/shared";
import { EMPTY_PANEL, errorMessage } from "./helpers";
import { JudgingEmptyState } from "./judging-empty-state";

function isTextQuestion(question: Question): boolean {
  return question.kind === "short_text" || question.kind === "long_text";
}

export function ReviewForm({
  entry,
  challenge,
  panel: roomPanel,
  roomId,
  canJudge,
  onCloseExisting,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  /**
   * The room's own judging form (H46). A room serving a shared queue scores
   * every team with one merged form, whichever of the group's challenges they
   * applied to, so it wins over the challenge's own panel; for a
   * one-challenge queue the two are the same list.
   */
  panel?: Question[] | null;
  roomId: number | null;
  canJudge: boolean;
  onCloseExisting?: () => void;
}) {
  const { t } = useLocale();
  const entryId = entry?.id;
  const panel = roomPanel ?? challenge?.judging_panel_criteria ?? EMPTY_PANEL;
  const [scores, setScores] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [sessions, setSessions] = useState<JudgingSession[]>([]);
  const [leases, setLeases] = useState<ReviewFieldLease[]>([]);
  const [ownedFields, setOwnedFields] = useState<Set<string>>(() => new Set());
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [versions, setVersions] = useState<AttemptReviewVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const savedScoresRef = useRef<Record<string, unknown>>({});
  const pendingFieldsRef = useRef(new Map<string, unknown>());
  const savingRef = useRef(false);
  const reviewStampRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalUpdate, setExternalUpdate] = useState<string | null>(null);
  const requiredUnansweredCount = requiredUnanswered(panel, scores);
  const fieldLabel = useCallback((field: string) => changedFieldLabel(field, panel, t), [panel, t]);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const loadRemote = useCallback(
    async (external = false) => {
      if (!entryId) return;
      const [review, activeSessions, reviewVersions, activeLeases] = await Promise.all([
        getReview(entryId),
        getSessions(entryId),
        getReviewVersions(entryId),
        getReviewFieldLeases(entryId),
      ]);
      setSessions(activeSessions);
      setVersions(reviewVersions);
      setLeases(activeLeases);
      const remoteStamp = review.updated_at ?? review.created_at ?? JSON.stringify(review);
      if (external && (savingRef.current || remoteStamp === reviewStampRef.current)) return;
      if (external && dirtyRef.current) {
        setConflict(true);
        return;
      }
      savedScoresRef.current = review.scores ?? {};
      setScores(normalizeAnswers(panel, review.scores));
      setNotes(review.notes ?? "");
      setStatus(review.status);
      reviewStampRef.current = remoteStamp;
      pendingFieldsRef.current.clear();
      dirtyRef.current = false;
      setDirty(false);
      setConflict(false);
      if (external) {
        const last = reviewVersions.at(-1);
        setExternalUpdate(
          last?.changed_fields.map(fieldLabel).join(", ") ?? t("evaluationUpdatedElsewhere"),
        );
      }
    },
    [fieldLabel, entryId, panel, t],
  );

  const loadInitialReview = useEffectEvent(() => loadRemote());

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Data-fetch-on-mount.
    setLoading(true);
    setSaveError(null);
    setOwnedFields(new Set());
    setFocusedField(null);
    void Promise.all([
      loadInitialReview(),
      canJudge
        ? openSession(entryId, roomId ?? undefined).catch(() => null)
        : Promise.resolve(null),
    ])
      .catch((err) => setSaveError(errorMessage(err, t("couldNotLoadReview"))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (canJudge) void closeSession(entryId).catch(() => undefined);
    };
  }, [entryId, canJudge, roomId, t]);

  const acquireField = useCallback(
    async (field: string) => {
      if (!entryId || !canJudge) return;
      setFocusedField(field);
      try {
        const lease = await acquireReviewFieldLease(entryId, field);
        setLeases((current) => [...current.filter((item) => item.field !== field), lease]);
        setOwnedFields((current) => new Set(current).add(field));
      } catch {
        setOwnedFields((current) => {
          const next = new Set(current);
          next.delete(field);
          return next;
        });
        void getReviewFieldLeases(entryId)
          .then(setLeases)
          .catch(() => undefined);
      }
    },
    [canJudge, entryId],
  );

  const releaseField = useCallback(
    async (field: string) => {
      if (!entryId) return;
      setFocusedField((current) => (current === field ? null : current));
      // H36: blur must not release a text edit before its autosave commits.
      if (pendingFieldsRef.current.has(field)) return;
      setOwnedFields((current) => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
      try {
        await releaseReviewFieldLease(entryId, field);
      } finally {
        void getReviewFieldLeases(entryId)
          .then(setLeases)
          .catch(() => undefined);
      }
    },
    [entryId],
  );

  // Refresh only the focused lease. PostgreSQL owns expiry, so this stops on
  // an abandoned tab and another judge can acquire the field within 30s.
  useEffect(() => {
    if (!entryId || !focusedField || !ownedFields.has(focusedField)) return;
    const timer = window.setInterval(() => void acquireField(focusedField), 10_000);
    return () => window.clearInterval(timer);
  }, [acquireField, entryId, focusedField, ownedFields]);

  useEventSource(entry ? `/api/queue/entries/${entryId}/stream` : "", {
    events: [EVENTS.QUEUE_REVIEW_CHANGED],
    enabled: entry != null,
    onEvent: () => void loadRemote(true),
  });

  const save = useCallback(
    async (submit = false, announce = true) => {
      if (!entryId || !online || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        // H36: send only local edits so untouched fields never require a
        // lease or overwrite another judge's answers. Reclaim expired leases
        // before retrying; an active owner still blocks the write.
        const pending = new Map(pendingFieldsRef.current);
        const scorePatch: Answers = {};
        if (submit) {
          for (const question of panel) {
            if (!isTextQuestion(question) && savedScoresRef.current[question.key] === undefined) {
              scorePatch[question.key] = scores[question.key];
            }
          }
        }
        const textFields = [...pending.keys()].filter(
          (field) =>
            field === "notes" ||
            panel.some(
              (question) => isTextQuestion(question) && field === `scores.${question.key}`,
            ),
        );
        for (const field of textFields) await acquireReviewFieldLease(entryId, field);
        for (const [field, value] of pending) {
          if (field.startsWith("scores.")) scorePatch[field.slice(7)] = value as Answers[string];
        }
        const review = await saveReview(entryId, {
          scores: scorePatch,
          ...(pending.has("notes") ? { notes: pending.get("notes") } : {}),
          submit,
        });
        for (const [field, value] of pending) {
          if (pendingFieldsRef.current.get(field) === value) pendingFieldsRef.current.delete(field);
        }
        savedScoresRef.current = review.scores ?? savedScoresRef.current;
        setStatus(review.status);
        reviewStampRef.current = review.updated_at ?? review.created_at ?? JSON.stringify(review);
        dirtyRef.current = pendingFieldsRef.current.size > 0;
        setDirty(dirtyRef.current);
        setConflict(false);
        for (const field of textFields) {
          if (field !== focusedField) await releaseField(field);
        }
        setVersions(await getReviewVersions(entryId));
        if (announce)
          toast.success(submit ? t("reviewSubmitted") : t("draftSaved"), {
            compactTitle: t("saveReview"),
          });
      } catch (err) {
        const fallback = t("couldNotSaveReview");
        const message = errorMessage(err, fallback);
        setSaveError(message);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [entryId, focusedField, online, panel, releaseField, scores, t],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: H36 notes edits restart the debounce while already dirty.
  useEffect(() => {
    if (!dirty || saving || saveError || !online || !canJudge || conflict) return;
    const timer = window.setTimeout(() => void save(false, false), 800);
    return () => window.clearTimeout(timer);
  }, [canJudge, conflict, dirty, online, save, saveError, saving, notes]);

  const syncState = collaborationState({ online, saving, conflict, dirty });
  const syncLabel = {
    saving: t("saveStateSaving"),
    saved: t("saved"),
    offline: t("collaborationOffline"),
    conflict: t("collaborationConflict"),
    unsaved: t("unsavedChanges"),
  }[syncState];
  const cardClassName = "relative flex min-h-0 flex-1 flex-col";
  const bodyClassName =
    "min-h-0 flex-1 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden";
  const lockedMessage = (field: string) => {
    if (ownedFields.has(field)) return null;
    const lease = leases.find((item) => item.field === field);
    if (!lease) return null;
    const name = `${lease.name ?? t("judgeFallback")} ${lease.surname ?? ""}`.trim();
    return t("reviewFieldEditingBy", { judge: name });
  };
  const textFieldReadOnly = (field: string) => canJudge && !ownedFields.has(field);

  if (!entryId) {
    return (
      <SectionCard
        title={t("scoring")}
        description={t("scoringFormDesc")}
        className={cardClassName}
        headerClassName="p-3 sm:p-4"
        bodyClassName={`${bodyClassName} flex flex-col`}
      >
        <JudgingEmptyState
          className="flex-1"
          icon={DoorOpenIcon}
          title={t("noActiveEvaluation")}
          description={t("scoringFormDesc")}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t("scoring")}
      icon={CheckCircleIcon}
      className={cardClassName}
      headerClassName="p-3 sm:p-4"
      bodyClassName={`${bodyClassName} flex flex-col pb-24 sm:pb-24`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
            {syncState === "offline" && (
              <WifiSlashIcon aria-hidden="true" className="mr-1 inline size-4" />
            )}
            {syncLabel}
          </span>
          <ReviewStatusBadge status={status === "submitted" ? "submitted" : "draft"} />
          {onCloseExisting && (
            <Button size="sm" variant="outline" onClick={onCloseExisting}>
              {t("closeExistingEvaluation")}
            </Button>
          )}
        </div>
      }
      footer={
        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <Button
            className="shadow-sm"
            variant="outline"
            size="sm"
            disabled={!canJudge || !online || saving || loading}
            onClick={() => save(false)}
            loading={saving}
          >
            {status === "submitted" ? t("saveCorrection") : t("saveDraft")}
          </Button>
          {status !== "submitted" && (
            <Button
              className="shadow-sm"
              size="sm"
              disabled={!canJudge || !online || saving || loading || requiredUnansweredCount > 0}
              onClick={() => save(true)}
              loading={saving}
            >
              <CheckCircleIcon aria-hidden="true" className="size-4" />
              {t("submitReview")}
            </Button>
          )}
        </div>
      }
      footerClassName="pointer-events-none absolute inset-x-4 bottom-4 z-10 p-0 sm:p-0"
    >
      {loading ? (
        <Spinner />
      ) : panel.length === 0 ? (
        <JudgingEmptyState
          className="flex-1"
          icon={ListChecksIcon}
          title={t("noJudgingCriteria")}
        />
      ) : (
        <div className="space-y-5">
          {saveError && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
            >
              {saveError}
            </div>
          )}
          {syncState === "offline" && (
            <div
              role="status"
              className="border-warning/40 bg-warning/10 text-warning-foreground rounded-md border p-3 text-sm"
            >
              {t("offlineEvaluationPending")}
            </div>
          )}
          {syncState === "conflict" && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm"
            >
              <p>{t("evaluationConflictDescription")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void loadRemote(false)}>
                  {t("loadLatestEvaluation")}
                </Button>
                <Button size="sm" onClick={() => void save(false)}>
                  {t("keepMyEvaluation")}
                </Button>
              </div>
            </div>
          )}
          {externalUpdate && !conflict && (
            <p role="status" className="text-muted-foreground text-sm">
              {t("criterionUpdatedElsewhere", { fields: externalUpdate })}
            </p>
          )}
          {requiredUnansweredCount > 0 && (
            <div className="border-warning/40 bg-warning/10 text-warning-foreground flex items-center gap-2 rounded-md border p-3 text-sm">
              <WarningIcon aria-hidden="true" className="size-4 shrink-0" />
              {requiredUnansweredCount === 1
                ? t("requiredFieldUnansweredOne", { count: requiredUnansweredCount })
                : t("requiredFieldUnansweredOther", { count: requiredUnansweredCount })}
            </div>
          )}
          {sessions.length > 0 && (
            <div className="rounded-md border px-3 py-2">
              <p className="text-sm font-medium">{t("activeJudges")}</p>
              <p className="text-muted-foreground text-sm">
                {sessions
                  .map((session) =>
                    `${session.name ?? t("judgeFallback")} ${session.surname ?? ""}`.trim(),
                  )
                  .join(", ")}
              </p>
            </div>
          )}
          {panel.map((question) => (
            <QuestionField
              key={question.key}
              question={question}
              value={scores[question.key]}
              disabled={!canJudge}
              readOnly={isTextQuestion(question) && textFieldReadOnly(`scores.${question.key}`)}
              lockedMessage={
                isTextQuestion(question) ? lockedMessage(`scores.${question.key}`) : null
              }
              onFocus={
                isTextQuestion(question)
                  ? () => void acquireField(`scores.${question.key}`)
                  : undefined
              }
              onBlur={
                isTextQuestion(question)
                  ? () => void releaseField(`scores.${question.key}`)
                  : undefined
              }
              onChange={(value) => {
                setScores((current) => ({ ...current, [question.key]: value }));
                pendingFieldsRef.current.set(`scores.${question.key}`, value);
                setSaveError(null);
                dirtyRef.current = true;
                setDirty(true);
                setExternalUpdate(null);
              }}
            />
          ))}
          <div className="space-y-2">
            <Label htmlFor="review-notes">{t("notesLabel")}</Label>
            <Textarea
              id="review-notes"
              value={notes}
              readOnly={textFieldReadOnly("notes")}
              onFocus={() => void acquireField("notes")}
              onBlur={() => void releaseField("notes")}
              onChange={(event) => {
                setNotes(event.target.value);
                pendingFieldsRef.current.set("notes", event.target.value);
                setSaveError(null);
                dirtyRef.current = true;
                setDirty(true);
              }}
              disabled={!canJudge}
              placeholder={t("privateJudgingNotes")}
            />
            {lockedMessage("notes") && (
              <p role="status" className="text-muted-foreground text-sm">
                {lockedMessage("notes")}
              </p>
            )}
          </div>
          {versions.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("evaluationVersionHistory")}
              </summary>
              <ol className="mt-3 space-y-2">
                {[...versions].reverse().map((version) => (
                  <li key={version.id} className="text-muted-foreground text-sm">
                    <span className="text-foreground font-medium">
                      {`${version.name ?? t("judgeFallback")} ${version.surname ?? ""}`.trim()}
                    </span>{" "}
                    · {new Date(version.created_at).toLocaleString()} ·{" "}
                    {version.changed_fields.map(fieldLabel).join(", ")}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}
