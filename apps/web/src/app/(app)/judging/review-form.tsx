"use client";

// Collaborative evaluation form (H36): field-level last-write-wins saves,
// conflict reconciliation, judge presence and offline handling. The rules it
// shares with the reviews-overview detail live in lib/attempt-review.ts.

import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { AlertTriangleIcon, CheckCircle2Icon, WifiOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  closeSession,
  getReview,
  getReviewVersions,
  getSessions,
  type JudgingSession,
  openSession,
  type QueueEntry,
  saveReview,
} from "@/lib/queue";
import type { Challenge } from "../challenges/shared";
import { EMPTY_PANEL, errorMessage } from "./helpers";

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
  const panel = roomPanel ?? challenge?.judging_panel_criteria ?? EMPTY_PANEL;
  const [scores, setScores] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [sessions, setSessions] = useState<JudgingSession[]>([]);
  const [versions, setVersions] = useState<AttemptReviewVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
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
      if (!entry) return;
      const [review, activeSessions, reviewVersions] = await Promise.all([
        getReview(entry.id),
        getSessions(entry.id),
        getReviewVersions(entry.id),
      ]);
      setSessions(activeSessions);
      setVersions(reviewVersions);
      const remoteStamp = review.updated_at ?? review.created_at ?? JSON.stringify(review);
      if (external && (savingRef.current || remoteStamp === reviewStampRef.current)) return;
      if (external && dirtyRef.current) {
        setConflict(true);
        return;
      }
      setScores(normalizeAnswers(panel, review.scores));
      setNotes(review.notes ?? "");
      setStatus(review.status);
      reviewStampRef.current = remoteStamp;
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
    [fieldLabel, entry, panel, t],
  );

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Data-fetch-on-mount.
    setLoading(true);
    setSaveError(null);
    void Promise.all([
      loadRemote(),
      canJudge
        ? openSession(entry.id, roomId ?? undefined).catch(() => null)
        : Promise.resolve(null),
    ])
      .catch((err) => setSaveError(errorMessage(err, t("couldNotLoadReview"))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (canJudge) void closeSession(entry.id).catch(() => undefined);
    };
  }, [entry, canJudge, loadRemote, roomId, t]);

  useEventSource(entry ? `/api/queue/entries/${entry.id}/stream` : "", {
    events: [EVENTS.QUEUE_REVIEW_CHANGED],
    enabled: entry != null,
    onEvent: () => void loadRemote(true),
  });

  const save = useCallback(
    async (submit = false, announce = true) => {
      if (!entry || !online) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        const review = await saveReview(entry.id, { scores, notes, submit });
        setStatus(review.status);
        reviewStampRef.current = review.updated_at ?? review.created_at ?? JSON.stringify(review);
        dirtyRef.current = false;
        setDirty(false);
        setConflict(false);
        setVersions(await getReviewVersions(entry.id));
        if (announce) toast.success(submit ? t("reviewSubmitted") : t("draftSaved"));
      } catch (err) {
        const message = errorMessage(err, t("couldNotSaveReview"));
        setSaveError(message);
        if (announce) toast.error(message);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [entry, scores, notes, online, t],
  );

  useEffect(() => {
    if (!dirty || !online || !canJudge || conflict) return;
    const timer = window.setTimeout(() => void save(false, false), 800);
    return () => window.clearTimeout(timer);
  }, [canJudge, conflict, dirty, online, save]);

  const syncState = collaborationState({ online, saving, conflict, dirty });
  const syncLabel = {
    saving: t("saveStateSaving"),
    saved: t("saved"),
    offline: t("collaborationOffline"),
    conflict: t("collaborationConflict"),
    unsaved: t("unsavedChanges"),
  }[syncState];

  if (!entry) {
    return (
      <SectionCard title={t("scoring")} description={t("scoringFormDesc")}>
        <p className="text-muted-foreground text-sm">{t("noActiveEntrySelected")}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t("scoring")}
      icon={CheckCircle2Icon}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
            {syncState === "offline" && <WifiOffIcon className="mr-1 inline size-4" />}
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
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!canJudge || saving || loading}
            onClick={() => save(false)}
          >
            {status === "submitted" ? t("saveCorrection") : t("saveDraft")}
          </Button>
          {status !== "submitted" && (
            <Button
              disabled={!canJudge || saving || loading || requiredUnansweredCount > 0}
              onClick={() => save(true)}
            >
              <CheckCircle2Icon className="size-4" />
              {t("submitReview")}
            </Button>
          )}
        </div>
      }
    >
      {loading ? (
        <Spinner />
      ) : panel.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noJudgingCriteria")}</p>
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
              <AlertTriangleIcon className="size-4 shrink-0" />
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
              onChange={(value) => {
                setScores((current) => ({ ...current, [question.key]: value }));
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
              onChange={(event) => {
                setNotes(event.target.value);
                dirtyRef.current = true;
                setDirty(true);
              }}
              disabled={!canJudge}
              placeholder={t("privateJudgingNotes")}
            />
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
