"use client";

import { ArrowLeftIcon, TrophyIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
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
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

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
  const [hasOpenApplications, setHasOpenApplications] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.get<{ items: PublicChallenge[] }>("/api/public/challenges");
      setChallenge(items.find((c) => String(c.id) === id) ?? null);
    } catch {
      setChallenge(null);
    }
  }, [id]);

  const loadApplications = useCallback(async () => {
    try {
      const { applications } = await api.get<{ applications: PublicApplicationForm[] }>(
        "/api/public/applications",
      );
      setHasOpenApplications(applications.length > 0);
    } catch {
      setHasOpenApplications(false);
    }
  }, []);

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
        <Link href="/">
          <Brand />
        </Link>
        <ThemeToggle />
      </header>

      <Button variant="ghost" size="sm" asChild className="mb-6">
        <Link href="/">
          <ArrowLeftIcon className="size-4" />
          {t("backToEvent")}
        </Link>
      </Button>

      {challenge === undefined && (
        <div className="grid place-items-center py-24" role="status" aria-busy="true">
          <Spinner className="size-7" />
          <span className="sr-only">{t("loadingChallenge")}</span>
        </div>
      )}

      {challenge === null && (
        <EmptyState
          icon={TrophyIcon}
          title={t("challengeNotFoundTitle")}
          description={t("challengeUnpublishedDesc")}
          action={
            <Button asChild>
              <Link href="/">{t("backToEvent")}</Link>
            </Button>
          }
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

          {hasOpenApplications && (
            <div className="mt-10 border-t pt-6">
              <Button size="lg" asChild>
                <Link href="/signup">{t("applyNow")}</Link>
              </Button>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
