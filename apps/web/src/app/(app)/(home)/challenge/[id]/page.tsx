"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { HeroBleed } from "@/components/common/hero-bleed";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
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
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLogoColor } from "@/lib/company";
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
  const {
    winners,
    error: winnersError,
    refetch: refetchWinners,
  } = usePublishedWinners(`/api/public/challenges/${encodeURIComponent(id)}/winners`);
  // H49: an unavailable public feed is different from a successful lookup with no matching id.
  const {
    data: feed,
    error: challengeError,
    reload: reloadChallenge,
  } = useServerResource(["public", "challenges"], (signal) =>
    api.get<{ items: PublicChallenge[] }>("/api/public/challenges", { signal }),
  );
  const challenge = feed ? (feed.items.find((c) => String(c.id) === id) ?? null) : undefined;
  const {
    data: applicationForms,
    error: applicationsError,
    loading: applicationsLoading,
    reload: reloadApplications,
  } = useServerResource(
    ["public", "applications"],
    (signal) =>
      api.get<{ applications: PublicApplicationForm[] }>("/api/public/applications", { signal }),
    { enabled: status === "unauthenticated" },
  );
  const hasOpenApplications = applicationForms ? applicationForms.applications.length > 0 : null;
  const applicationsFailed = applicationsError != null;

  const logoColor = useLogoColor(challenge?.enterprise.logoUrl);

  useEffect(() => {
    if (challenge) document.title = displayText(challenge.title, language);
  }, [challenge, language]);

  return (
    <>
      {authenticated && challenge ? (
        <HeroBleed color={logoColor}>
          <BackLink href="/event" label={t("eventInformation")} />
          <header className="space-y-4 pt-4">
            <h2 className="font-display text-3xl leading-tight text-balance sm:text-5xl">
              {displayText(challenge.title, language)}
            </h2>
            <CompanyLink
              href={`/companies/${challenge.enterprise.id}`}
              className="flex items-center gap-3"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white p-1.5 shadow-sm dark:bg-card">
                {challenge.enterprise.logoUrl && (
                  <SponsorLogo
                    logoUrl={challenge.enterprise.logoUrl}
                    logoNegativeUrl={challenge.enterprise.logoNegativeUrl}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </span>
              <span className="text-sm font-medium">{challenge.enterprise.name}</span>
            </CompanyLink>
          </header>
        </HeroBleed>
      ) : (
        <PageHeader
          headingLevel={authenticated ? 2 : 1}
          title={challenge ? displayText(challenge.title, language) : t("challenges")}
          meta={
            challenge && (
              <CompanyLink
                href={authenticated ? `/companies/${challenge.enterprise.id}` : null}
                className="mt-2 flex items-center gap-3"
              >
                {challenge.enterprise.logoUrl && (
                  <SponsorLogo
                    logoUrl={challenge.enterprise.logoUrl}
                    logoNegativeUrl={challenge.enterprise.logoNegativeUrl}
                    alt=""
                    className="h-8 max-w-36 object-contain"
                  />
                )}
                <span className="text-sm text-muted-foreground">{challenge.enterprise.name}</span>
              </CompanyLink>
            )
          }
          context={
            <BackLink
              href={authenticated ? "/event" : "/"}
              label={t(authenticated ? "eventInformation" : "home")}
            />
          }
        />
      )}

      <Body wrap={authenticated}>
        {challengeError ? (
          <ContextualError
            message={apiErrorText(challengeError, t, t("couldNotLoadChallenge"))}
            onRetry={reloadChallenge}
          />
        ) : null}

        {challenge === undefined && !challengeError && (
          <div className="grid place-items-center py-24" role="status" aria-busy="true">
            <Spinner className="size-7" />
            <span className="sr-only">{t("loadingChallenge")}</span>
          </div>
        )}

        {challenge === null && !challengeError && (
          // The persistent back link above is the page's stable
          // escape hatch; a second one here said it twice (#299).
          <EmptyState
            title={t("challengeNotFoundTitle")}
            description={t("challengeUnpublishedDesc")}
          />
        )}

        {challenge && winnersError != null && winners.length === 0 && (
          <ContextualError
            className="mb-6"
            message={apiErrorText(winnersError, t, t("couldNotLoadWinners"))}
            onRetry={refetchWinners}
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
                <Lines text={displayText(challenge.description, language)} large />
                {displayText(challenge.criteria, language) && (
                  <section className="space-y-3 border-t border-border/60 pt-5">
                    <h2 className="type-meta font-medium text-muted-foreground">
                      {t("judgingCriteriaTitle")}
                    </h2>
                    <Lines text={displayText(challenge.criteria, language)} />
                  </section>
                )}
              </div>
              {(winners.length > 0 || asPrizes(challenge.prizes).length > 0) && (
                <div className="space-y-6">
                  {winners.length > 0 && (
                    <SectionCard title={t("winnersTabLabel")}>
                      <ol className="divide-y divide-border/60">
                        {winners.map((winner) => (
                          <li key={winner.rank} className="space-y-3 py-3 first:pt-0 last:pb-0">
                            <StatusBadge tone="success" icon={<TrophyIcon aria-hidden="true" />}>
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
                    <SectionCard title={t("prizesLabel")}>
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

            {!authenticated &&
              (applicationsLoading || applicationsFailed || hasOpenApplications) && (
                <div className="mt-10 border-t pt-6">
                  {applicationsLoading && (
                    <div className="text-muted-foreground flex items-center gap-2" role="status">
                      <Spinner />
                      <span className="sr-only">{t("loading")}</span>
                    </div>
                  )}
                  {applicationsFailed && (
                    <ContextualError
                      message={apiErrorText(
                        applicationsError,
                        t,
                        t("couldNotLoadApplicationForms"),
                      )}
                      onRetry={reloadApplications}
                    />
                  )}
                  {(applicationsFailed || hasOpenApplications) && (
                    <Button size="lg" asChild className={applicationsFailed ? "mt-4" : undefined}>
                      <Link href={withReturnPath("/signup", "/my-applications")}>
                        {t("applyNow")}
                      </Link>
                    </Button>
                  )}
                </div>
              )}
          </article>
        )}
      </Body>
    </>
  );
}

/** Signed-in pages leave the hero full-bleed, so the body sets its own reading width. */
function Body({ wrap, children }: { wrap: boolean; children: React.ReactNode }) {
  return wrap ? <PageLayout width="reading">{children}</PageLayout> : <>{children}</>;
}

function CompanyLink({
  href,
  className,
  children,
}: {
  href: string | null;
  className: string;
  children: React.ReactNode;
}) {
  return href ? (
    <Link
      href={href}
      className={`${className} button-interaction w-fit rounded-sm hover:underline`}
    >
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** Paragraphs split on blank lines; runs of "- " lines become a bulleted list. */
function Lines({ text, large = false }: { text: string; large?: boolean }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.split("\n").filter(Boolean));
  const textClass = large ? "text-base leading-relaxed" : "text-sm leading-relaxed";
  return (
    <div className="space-y-4">
      {blocks.map((lines) => {
        const key = lines.join("|");
        const bullets = lines.every((line) => /^\s*[-•]\s+/.test(line));
        return bullets ? (
          <ul key={key} className={`list-disc space-y-1.5 pl-5 text-pretty ${textClass}`}>
            {lines.map((line) => (
              <li key={line}>{line.replace(/^\s*[-•]\s+/, "")}</li>
            ))}
          </ul>
        ) : (
          <p key={key} className={`whitespace-pre-line text-pretty ${textClass}`}>
            {lines.join("\n")}
          </p>
        );
      })}
    </div>
  );
}
