"use client";

// Minimal companion window for review-modal.tsx's "open review window"
// action: only the score/notes composer, never the application shell. Kept
// as its own route (rather than a mode of /applications/[id]) so it has no
// sidebar, no navigation chrome, and can be dropped into a real popup or a
// Document Picture-in-Picture window unmodified.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  type ReviewComposerProps,
  ReviewPanelCard,
} from "@/components/applications/review-composer";
import { type ReviewSyncMessage, useReviewSync } from "@/components/applications/review-sync";
import { useReviewAutosave } from "@/components/applications/use-review-autosave";
import { Spinner } from "@/components/common/spinner";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";

interface PopupResponseDetail {
  response: { id: number; status: string };
  user: { name: string | null; email: string };
  reviews: { author_id: number; score: number | null; notes: string | null }[];
}

function ReviewPopupInner() {
  const { t } = useLocale();
  const params = useParams<{ responseId: string }>();
  const searchParams = useSearchParams();
  const applicationId = Number(searchParams.get("applicationId")) || null;
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const me = useMe();

  const [responseId, setResponseId] = useState(() => Number(params.responseId));
  const [status, setStatus] = useState<string | null>(null);
  const [applicant, setApplicant] = useState<{ name: string | null; email: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const review = useReviewAutosave(responseId, canReview, { score: null, notes: "" });

  // Independent fetch of whichever response is currently active — on first
  // load, and again whenever the main tab's navigation moves it to a
  // different applicant (see useReviewSync below).
  // biome-ignore lint/correctness/useExhaustiveDependencies: review.seed is stable per canReview; re-fetching on it would reload on every permission change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api
      .get<PopupResponseDetail>(`/api/responses/${responseId}`)
      .then((detail) => {
        if (cancelled) return;
        setStatus(detail.response.status);
        setApplicant(detail.user);
        if (!review.isDirty()) {
          const mine = detail.reviews.find((r) => r.author_id === me?.id);
          review.seed(responseId, { score: mine?.score ?? null, notes: mine?.notes ?? "" });
        }
      })
      .catch((error) => {
        console.error("[review:popup] load failed", error);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [responseId, me?.id]);

  // Independent autosave (H29): this window keeps working — and keeps
  // saving — even if the reviewer closes the main modal tab that opened it.
  useReviewSync(
    applicationId,
    review.responseId === responseId && status !== null
      ? {
          responseId,
          score: review.score,
          notes: review.notes,
          saveState: review.saveState,
          status,
        }
      : null,
    (message: ReviewSyncMessage) => {
      if (message.responseId !== responseId) {
        // The main tab navigated to a different applicant — follow it.
        setResponseId(message.responseId);
        setStatus(message.status);
        review.seed(
          message.responseId,
          { score: message.score, notes: message.notes },
          message.saveState,
        );
        return;
      }
      review.applyRemote(message);
    },
  );

  if (loading && !applicant) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (loadError || !applicant) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4 text-center">
        <p className="text-muted-foreground text-sm">{t("actionFailed")}</p>
      </div>
    );
  }

  const canScore = canReview && status !== "draft";
  const composerProps: ReviewComposerProps = {
    responseId,
    myScore: review.score,
    onScoreChange: review.setScore,
    myNotes: review.notes,
    onNotesChange: review.setNotes,
    reviewSaveState: review.saveState,
  };

  return (
    <div className="min-h-dvh p-3">
      <div className="mb-2 min-w-0">
        <p className="truncate text-sm font-medium" title={applicant.name ?? applicant.email}>
          {applicant.name ?? applicant.email}
        </p>
        {applicant.name && (
          <p className="text-muted-foreground truncate text-xs">{applicant.email}</p>
        )}
      </div>
      {canScore ? (
        <ReviewPanelCard {...composerProps} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("reviewComposerUnavailable")}</p>
      )}
    </div>
  );
}

export default function ReviewPopupPage() {
  return (
    <Suspense>
      <ReviewPopupInner />
    </Suspense>
  );
}
