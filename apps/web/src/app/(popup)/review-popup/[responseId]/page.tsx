"use client";

// Minimal companion window for review-modal.tsx's "open review window"
// action: only the score/notes composer, never the application shell. Kept
// as its own route (rather than a mode of /applications/[id]) so it has no
// sidebar, no navigation chrome, and can be dropped into a real popup or a
// Document Picture-in-Picture window unmodified.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { type ReviewComposerProps, ReviewPanelCard } from "@/components/applications/review-modal";
import { type ReviewSyncMessage, useReviewSync } from "@/components/applications/review-sync";
import { Spinner } from "@/components/common/spinner";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
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

  const [myScore, setMyScore] = useState<number | null>(null);
  const [myNotes, setMyNotes] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // Only a local, user-driven edit should mark this dirty — an update that
  // arrived from the main tab over BroadcastChannel must not re-trigger this
  // window's own autosave PUT (that's how the two would end up racing).
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef({
    responseId: Number(params.responseId),
    score: null as number | null,
    notes: "",
    dirty: false,
  });

  // Independent fetch of whichever response is currently active — on first
  // load, and again whenever the main tab's navigation moves it to a
  // different applicant (see useReviewSync below).
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
        if (!dirtyRef.current) {
          const mine = detail.reviews.find((r) => r.author_id === me?.id);
          setMyScore(mine?.score ?? null);
          setMyNotes(mine?.notes ?? "");
          draftRef.current = {
            responseId,
            score: mine?.score ?? null,
            notes: mine?.notes ?? "",
            dirty: false,
          };
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [responseId, me?.id]);

  useEffect(
    () => () => {
      const draft = draftRef.current;
      if (!draft.dirty || !canReview) return;
      void api.put(`/api/responses/${draft.responseId}/my-review`, {
        score: draft.score,
        notes: draft.notes.trim() || null,
      });
    },
    [canReview],
  );

  // Independent autosave (H29): this window keeps working — and keeps
  // saving — even if the reviewer closes the main modal tab that opened it.
  useEffect(() => {
    if (!dirty || !canReview) return;
    const handle = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await api.put(`/api/responses/${responseId}/my-review`, {
          score: myScore,
          notes: myNotes.trim() || null,
        });
        if (draftRef.current.responseId === responseId) draftRef.current.dirty = false;
        setSaveState("saved");
        setDirty(false);
      } catch {
        setSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [responseId, myScore, myNotes, dirty, canReview]);

  useReviewSync(
    applicationId,
    { responseId, score: myScore, notes: myNotes, saveState, status: status ?? "" },
    (message: ReviewSyncMessage) => {
      if (message.responseId !== responseId) {
        // The main tab navigated to a different applicant — follow it.
        const draft = draftRef.current;
        if (draft.dirty && canReview) {
          void api.put(`/api/responses/${draft.responseId}/my-review`, {
            score: draft.score,
            notes: draft.notes.trim() || null,
          });
        }
        setResponseId(message.responseId);
        setStatus(message.status);
        setMyScore(message.score);
        setMyNotes(message.notes);
        setSaveState(message.saveState);
        setDirty(false);
        draftRef.current = {
          responseId: message.responseId,
          score: message.score,
          notes: message.notes,
          dirty: false,
        };
        return;
      }
      if (dirtyRef.current) return;
      setMyScore(message.score);
      setMyNotes(message.notes);
      setSaveState(message.saveState);
    },
  );

  function handleScoreChange(v: number | null) {
    draftRef.current = {
      responseId,
      score: v,
      notes: myNotes,
      dirty: true,
    };
    setMyScore(v);
    setDirty(true);
    setSaveState("saving");
  }
  function handleNotesChange(v: string) {
    draftRef.current = {
      responseId,
      score: myScore,
      notes: v,
      dirty: true,
    };
    setMyNotes(v);
    setDirty(true);
    setSaveState("saving");
  }

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
    myScore,
    onScoreChange: handleScoreChange,
    myNotes,
    onNotesChange: handleNotesChange,
    reviewSaveState: saveState,
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
