"use client";

import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { ThemeToggle } from "@/components/common/theme-toggle";
import {
  displayText,
  type PublicApplicationForm,
  type PublicChallenge,
} from "@/components/public/public-types";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";

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
  const { id } = useParams<{ id: string }>();
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
      setChallengeError(error instanceof ApiError ? error.message : t("couldNotLoadChallenge"));
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
      setApplicationsError(
        error instanceof ApiError ? error.message : t("couldNotLoadApplicationForms"),
      );
    } finally {
      setApplicationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  useEffect(() => {
    if (challenge) document.title = displayText(challenge.title, language);
  }, [challenge, language]);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex items-center justify-between gap-4 pb-6">
        <Brand />
        <ThemeToggle />
      </header>

      <Button variant="ghost" size="sm" asChild className="mb-6">
        <Link href="/">
          <ArrowLeftIcon className="size-4" />
          {t("backToEvent")}
        </Link>
      </Button>

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
        <article>
          <div className="flex items-center gap-3">
            {challenge.enterprise.logoUrl && (
              <SponsorLogo
                logoUrl={challenge.enterprise.logoUrl}
                logoNegativeUrl={challenge.enterprise.logoNegativeUrl}
                alt={challenge.enterprise.name}
                className="size-10 rounded-md object-contain"
              />
            )}
            <p className="text-muted-foreground text-sm font-medium">{challenge.enterprise.name}</p>
          </div>
          <h1 className="text-balance mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {displayText(challenge.title, language)}
          </h1>
          <p className="text-muted-foreground text-pretty mt-4 whitespace-pre-wrap text-base">
            {displayText(challenge.description, language)}
          </p>

          {displayText(challenge.criteria, language) && (
            <section className="mt-8 border-t pt-6">
              <h2 className="text-lg font-medium">{t("judgingCriteriaTitle")}</h2>
              <p className="text-muted-foreground text-pretty mt-2 whitespace-pre-wrap text-sm">
                {displayText(challenge.criteria, language)}
              </p>
            </section>
          )}

          {asPrizes(challenge.prizes).length > 0 && (
            <section className="mt-8 border-t pt-6">
              <h2 className="text-lg font-medium">{t("prizesLabel")}</h2>
              <ul className="mt-3 space-y-2">
                {asPrizes(challenge.prizes).map((prize) => (
                  <li
                    key={prize.name}
                    className="rounded-lg border p-3 text-sm font-medium shadow-sm"
                  >
                    {prize.link ? (
                      <a
                        href={prize.link}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        {prize.name}
                      </a>
                    ) : (
                      prize.name
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(applicationsLoading || applicationsError || hasOpenApplications) && (
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
    </div>
  );
}
