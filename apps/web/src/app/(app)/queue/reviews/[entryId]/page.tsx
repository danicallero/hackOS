"use client";

// Review detail (H46 gap-fill): the ficha behind a reviews-overview row —
// project and team, the challenge's judging panel questions WITH the answers
// recorded for this entry, the edit history, and two actions: correct the
// evaluation out of band, or message the team (H29 queue channel) to call them
// back. Visibility is scoped server-side exactly like the overview list.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ArrowLeftIcon, ClipboardListIcon, LockIcon, SendIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { type Answers, normalizeAnswers, QuestionField } from "@/components/common/question-field";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { ReviewStatusBadge } from "@/components/common/review-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { changedFieldLabel, requiredUnanswered } from "@/lib/attempt-review";
import { useLocale } from "@/lib/i18n";
import {
  getReviewDetail,
  messageReviewTeam,
  type ReviewDetail,
  saveReviewFromOverview,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { textForDisplay } from "../../../challenges/shared";

export default function ReviewDetailPage() {
  const params = useParams<{ entryId: string }>();
  const entryId = Number(params.entryId);
  const { t } = useLocale();
  const { can } = useSessionContext();
  const canMessage = can(CAPABILITIES.NOTIFICATIONS_SEND);

  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(entryId)) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getReviewDetail(entryId);
      setDetail(data);
      setAnswers(normalizeAnswers(data.challenge.criteria, data.review.scores));
      setNotes(data.review.notes ?? "");
      setDirty(false);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t("couldNotLoadReviews"));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [entryId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const panel = detail?.challenge.criteria ?? [];
  const requiredUnansweredCount = useMemo(
    () => requiredUnanswered(panel, answers),
    [panel, answers],
  );

  const save = useCallback(
    async (submit: boolean) => {
      if (!detail) return;
      setSaving(true);
      try {
        await saveReviewFromOverview(detail.entryId, { scores: answers, notes, submit });
        toast.success(submit ? t("reviewSubmitted") : t("evaluationUpdated"));
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotSaveReview"));
      } finally {
        setSaving(false);
      }
    },
    [answers, detail, load, notes, t],
  );

  const sendMessage = useCallback(async () => {
    if (!detail || !message.trim()) return;
    setSending(true);
    try {
      const { recipients } = await messageReviewTeam(detail.entryId, message.trim());
      toast.success(t("teamMessageSent", { count: recipients }));
      setMessage("");
      setMessageOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSendTeamMessage"));
    } finally {
      setSending(false);
    }
  }, [detail, message, t]);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("reviewDetailTitle")} />
        <EmptyState
          icon={LockIcon}
          title={loadError ?? t("couldNotLoadReviews")}
          description={t("reviewDetailAccessDesc")}
          action={
            <Button asChild variant="outline">
              <Link href="/queue/reviews">
                <ArrowLeftIcon className="size-4" />
                {t("backToReviews")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { project, review, room, challenge } = detail;
  return (
    <div className="space-y-6">
      <PageHeader
        context={
          <Link
            href="/queue/reviews"
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowLeftIcon className="size-3.5" />
            {t("backToReviews")}
          </Link>
        }
        title={project.name}
        description={textForDisplay(challenge.title)}
        state={
          <div className="flex flex-wrap items-center gap-2">
            <QueueStatusBadge status={detail.status} />
            <ReviewStatusBadge status={review.status} />
          </div>
        }
        primaryAction={
          canMessage ? (
            <Button onClick={() => setMessageOpen(true)}>
              <SendIcon className="size-4" />
              {t("messageTeam")}
            </Button>
          ) : undefined
        }
        secondaryActions={
          <Button asChild variant="outline">
            <Link href={`/projects/${project.id}`}>{t("openProject")}</Link>
          </Button>
        }
      />

      <SectionCard title={t("projectDetailsTitle")} icon={ClipboardListIcon}>
        <div className="space-y-4">
          <ProjectDescriptionLinks
            description={project.description}
            links={{
              devpostUrl: project.devpostUrl,
              demoUrl: project.demoUrl,
              githubUrl: project.githubUrl,
            }}
          />
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">{t("colRoom")}</dt>
              <dd className="text-sm">
                {room ? `${room.name}${room.location ? ` · ${room.location}` : ""}` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("lastUpdatedLabel")}</dt>
              <dd className="text-sm">
                {review.updatedAt ? new Date(review.updatedAt).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <UsersIcon className="text-muted-foreground size-4" />
              {t("teamMembersLabel")}
            </p>
            <p className="text-muted-foreground text-sm">
              {project.members.length === 0
                ? "—"
                : project.members.map((m) => m.name || m.email).join(", ")}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("evaluationPanelTitle")}
        description={t("evaluationPanelDesc")}
        footer={
          panel.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={saving || !dirty} onClick={() => save(false)}>
                {review.status === "submitted" ? t("saveCorrection") : t("saveDraft")}
              </Button>
              {review.status !== "submitted" && (
                <Button disabled={saving || requiredUnansweredCount > 0} onClick={() => save(true)}>
                  {t("submitReview")}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {panel.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noJudgingCriteria")}</p>
        ) : (
          <div className="space-y-5">
            {requiredUnansweredCount > 0 && (
              <p className="text-muted-foreground text-sm">
                {requiredUnansweredCount === 1
                  ? t("requiredFieldUnansweredOne", { count: requiredUnansweredCount })
                  : t("requiredFieldUnansweredOther", { count: requiredUnansweredCount })}
              </p>
            )}
            {panel.map((question) => (
              <QuestionField
                key={question.key}
                question={question}
                value={answers[question.key]}
                disabled={saving}
                onChange={(value) => {
                  setAnswers((current) => ({ ...current, [question.key]: value }));
                  setDirty(true);
                }}
              />
            ))}
            <div className="space-y-2">
              <Label htmlFor="review-detail-notes">{t("notesLabel")}</Label>
              <Textarea
                id="review-detail-notes"
                value={notes}
                disabled={saving}
                placeholder={t("privateJudgingNotes")}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setDirty(true);
                }}
              />
            </div>
          </div>
        )}
      </SectionCard>

      {detail.versions.length > 0 && (
        <SectionCard title={t("evaluationVersionHistory")}>
          <ol className="space-y-2">
            {[...detail.versions].reverse().map((version) => (
              <li key={version.id} className="text-muted-foreground text-sm">
                <span className="text-foreground font-medium">
                  {version.authorName || t("judgeFallback")}
                </span>{" "}
                · {new Date(version.createdAt).toLocaleString()} ·{" "}
                {version.changedFields.map((f) => changedFieldLabel(f, panel, t)).join(", ")}
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      <Modal
        open={messageOpen}
        onOpenChange={setMessageOpen}
        title={t("messageTeam")}
        description={t("messageTeamDesc")}
        icon={SendIcon}
        footer={
          <>
            <Button variant="outline" onClick={() => setMessageOpen(false)} disabled={sending}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void sendMessage()} disabled={sending || !message.trim()}>
              <SendIcon className="size-4" />
              {t("sendMessage")}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="team-message">{t("messageLabel")}</Label>
          <Textarea
            id="team-message"
            value={message}
            maxLength={1000}
            rows={5}
            disabled={sending}
            placeholder={t("messageTeamPlaceholder")}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
