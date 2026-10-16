"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { GiftIcon } from "@phosphor-icons/react/dist/csr/Gift";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { HomeSectionHeader } from "@/components/common/section-navigation";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import {
  displayText,
  type PublicApplicationForm,
  type PublicChallenge,
} from "@/components/public/public-types";
import { Button } from "@/components/ui/button";
import { usePublishedWinners } from "@/hooks/use-published-winners";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

interface Prize {
  name: string;
  link?: string | null;
}

function asPrizes(value: unknown): Prize[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is Prize => typeof p === "object" && p !== null && typeof (p as Prize).name === "string",
  );
}

export default function PublicChallengePage() {
  const { language, t } = useLocale();
  const { status } = useSessionContext();
  const authenticated = status === "authenticated";
  const { id } = useParams<{ id: string }>();
  const winners = usePublishedWinners(`/api/public/challenges/${encodeURIComponent(id)}/winners`);
  const [challenge, setChallenge] = useState<PublicChallenge | null | undefined>(undefined);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [hasOpenApplications, setHasOpenApplications] = useState<boolean | null>(null);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);

  // H49: an unavailable public feed is different from a successful lookup with no matching id.
  const load = useCallback(async () => {
    setChallenge(undefined);
    setChallengeError(null);
    try {
      const { items } = await api.get<{ items: PublicChallenge[] }>("/api/public/challenges");
      setChallenge(items.find((c) => String(c.id) === id) ?? null);
    } catch (error) {
      setChallengeError(apiErrorText(error, t, t("couldNotLoadChallenge")));
    }
  }, [id, t]);

  const loadApplications = useCallback(async () => {
    setApplicationsLoading(true);
    setApplicationsError(null);
    try {
      const { applications } = await api.get<{ applications: PublicApplicationForm[] }>(
        "/api/public/applications",
      );
      setHasOpenApplications(applications.length > 0);
    } catch (error) {
      setApplicationsError(apiErrorText(error, t, t("couldNotLoadApplicationForms")));
    } finally {
      setApplicationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === "unauthenticated") void loadApplications();
  }, [loadApplications, status]);

  useEffect(() => {
    if (challenge) document.title = displayText(challenge.title, language);
  }, [challenge, language]);

  return (
    <PageLayout>
      {authenticated && <HomeSectionHeader />}
      <PageHeader
        headingLevel={authenticated ? 2 : 1}
        title={challenge ? displayText(challenge.title, language) : t("challenges")}
        meta={
          challenge && (
            <div className="mt-2 flex items-center gap-3">
              {challenge.enterprise.logoUrl && (
                <SponsorLogo
                  logoUrl={challenge.enterprise.logoUrl}
                  logoNegativeUrl={challenge.enterprise.logoNegativeUrl}
                  alt=""
                  className="h-8 max-w-36 object-contain"
                />
              )}
              <span className="text-sm text-muted-foreground">{challenge.enterprise.name}</span>
            </div>
          )
        }
        secondaryActions={
          <Button variant="outline" size="sm" asChild>
            <Link href={authenticated ? "/event" : "/"}>
              <ArrowLeftIcon aria-hidden="true" />
              {t("backToEvent")}
            </Link>
          </Button>
        }
      />

      {challengeError && <ContextualError message={challengeError} onRetry={() => void load()} />}

      {challenge === undefined && !challengeError && (
        <div className="grid place-items-center py-24" role="status" aria-busy="true">
          <Spinner className="size-7" />
          <span className="sr-only">{t("loadingChallenge")}</span>
        </div>
      )}

      {challenge === null && !challengeError && (
        // The persistent "Back to event" button above is the page's stable
        // escape hatch; a second one here said it twice (#299).
        <EmptyState
          icon={TrophyIcon}
          title={t("challengeNotFoundTitle")}
          description={t("challengeUnpublishedDesc")}
        />
      )}

      {challenge && (
        <article className="space-y-6">
          <div
            className={
              winners.length > 0 || asPrizes(challenge.prizes).length > 0
                ? "grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]"
                : "max-w-prose"
            }
          >
            <div className="space-y-8">
              <p className="whitespace-pre-wrap text-pretty text-base leading-relaxed">
                {displayText(challenge.description, language)}
              </p>
              {displayText(challenge.criteria, language) && (
                <SectionCard
                  title={t("judgingCriteriaTitle")}
                  icon={ListChecksIcon}
                  variant="plain"
                >
                  <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed">
                    {displayText(challenge.criteria, language)}
                  </p>
                </SectionCard>
              )}
            </div>
            {(winners.length > 0 || asPrizes(challenge.prizes).length > 0) && (
              <div className="space-y-6">
                {winners.length > 0 && (
                  <SectionCard title={t("winnersTabLabel")} icon={TrophyIcon}>
                    <ol className="divide-y divide-border/60">
                      {winners.map((winner) => (
                        <li key={winner.rank} className="space-y-3 py-3 first:pt-0 last:pb-0">
                          <StatusBadge tone="success" dot={false}>
                            <TrophyIcon aria-hidden="true" />
                            {t("rankLabel", { rank: winner.rank })}
                          </StatusBadge>
                          <p className="type-section-title text-balance">{winner.repoName}</p>
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/gallery/${winner.repoId}`}>
                              {t("openProject")}
                              <ArrowRightIcon aria-hidden="true" />
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ol>
                  </SectionCard>
                )}
                {asPrizes(challenge.prizes).length > 0 && (
                  <SectionCard title={t("prizesLabel")} icon={GiftIcon} variant="plain">
                    <ul className="divide-y divide-border/60">
                      {asPrizes(challenge.prizes).map((prize) => (
                        <li key={prize.name} className="py-3 first:pt-0 last:pb-0">
                          {prize.link ? (
                            <Button asChild variant="outline" size="sm">
                              <a href={prize.link} target="_blank" rel="noopener noreferrer">
                                {prize.name}
                                <ArrowSquareOutIcon aria-hidden="true" />
                              </a>
                            </Button>
                          ) : (
                            <span className="text-sm">{prize.name}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </SectionCard>
                )}
              </div>
            )}
          </div>

          {!authenticated && (applicationsLoading || applicationsError || hasOpenApplications) && (
            <div className="mt-10 border-t pt-6">
              {applicationsLoading && (
                <div className="text-muted-foreground flex items-center gap-2" role="status">
                  <Spinner />
                  <span className="sr-only">{t("loading")}</span>
                </div>
              )}
              {applicationsError && (
                <ContextualError
                  message={applicationsError}
                  onRetry={() => void loadApplications()}
                />
              )}
              {(applicationsError || hasOpenApplications) && (
                <Button size="lg" asChild className={applicationsError ? "mt-4" : undefined}>
                  <Link href={withReturnPath("/signup", "/my-applications")}>{t("applyNow")}</Link>
                </Button>
              )}
            </div>
          )}
        </article>
      )}
    </PageLayout>
  );
}
