"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useParams } from "next/navigation";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { VisibilityBadge } from "@/components/common/publication-status";
import { Spinner } from "@/components/common/spinner";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { TrackTiming } from "@/components/projects/track-timing";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type Challenge, textForDisplay } from "@/lib/challenges";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { ChallengeAlertDialog } from "./challenge-alert-dialog";
import { EditCard } from "./challenge-cards";

export default function ChallengeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { t } = useLocale();
  const { canAny, me } = useSessionContext();
  const canAdmin = canAny(
    CAPABILITIES.SPONSORS_MANAGE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.CHALLENGES_MANAGE,
  );
  const canAlert = canAdmin || Boolean(me?.isSponsorRep);
  const validId = Number.isFinite(id);
  // Soft, in-place refresh when another admin edits this challenge elsewhere.
  // A failed background refetch keeps the loaded challenge (#1012).
  const {
    data: challenge,
    error,
    stale,
    refetch,
  } = useLiveQuery(
    (signal) => api.get<Challenge>(`/api/challenges/${id}`, { signal }),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { enabled: validId, resourceKey: ["challenge", id] },
  );
  const shownError = error && (challenge === null || isNotFoundError(error)) ? error : null;
  const notFound = !validId || isNotFoundError(shownError);
  const errorMsg = shownError ? apiErrorText(shownError, t, t("couldNotLoadChallenge")) : "";

  if (validId && !shownError && !challenge) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!validId || shownError || !challenge) {
    if (!notFound) {
      return (
        <ContextualError
          message={errorMsg || t("couldNotLoadChallenge")}
          onRetry={() => refetch()}
        />
      );
    }
    return (
      <div className="space-y-6">
        <EmptyState
          title={t("challengeNotFoundTitle")}
          description={errorMsg || t("challengeNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <PageLayout width="reading">
      {stale && <StaleDataNotice onRetry={() => refetch()} />}
      <PageHeader
        title={textForDisplay(challenge.title)}
        secondaryActions={
          (canAdmin || me?.isSponsorRep || me?.isEnterpriseJudge) && (
            <TrackTiming challengeId={id} onSaved={() => refetch()} />
          )
        }
        primaryAction={
          canAlert ? (
            <ChallengeAlertDialog challengeId={id} canTargetParticipants={canAdmin} />
          ) : undefined
        }
        state={
          <VisibilityBadge
            visibility={challenge.visibility}
            availableFrom={challenge.available_from}
          />
        }
      />

      <EditCard challenge={challenge} canAdmin={canAdmin} onSaved={() => refetch()} />
    </PageLayout>
  );
}
