"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import Link from "next/link";
import { useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { HeroBleed } from "@/components/common/hero-bleed";
import { PageLayout } from "@/components/common/page-layout";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { UserAvatar } from "@/components/common/user-avatar";
import { SpeakerStack } from "@/components/public/schedule-links";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerResource } from "@/hooks/use-server-resource";
import { isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import {
  type CompanyProfile as Company,
  companyAmbient,
  companyDescription,
  fetchCompanyProfile,
} from "@/lib/company";
import { eventDateFormat } from "@/lib/datetime";
import { socialLinkText } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { getPublicEvent } from "@/lib/public-content";

/**
 * A company's page (H44, H45, H59), as `GET /api/enterprises/:id/profile`
 * shows it to the caller: logo-tinted hero, description, website,
 * representatives, revealed challenges and the activities it takes part in.
 * Empty sections are omitted; a hidden or missing company reads as not found.
 */
export function CompanyProfile({ id }: { id: number }) {
  const { t } = useLocale();
  const valid = Number.isSafeInteger(id) && id > 0;
  const { data, error, reload } = useServerResource(
    ["company", id],
    (signal) => fetchCompanyProfile(id, signal),
    { enabled: valid },
  );
  const back = <BackLink href="/event" label={t("eventInformation")} />;
  const missing = !valid || isNotFoundError(error);

  if (!data || missing) {
    return (
      <PageLayout width="reading">
        {back}
        {missing ? (
          <EmptyState title={t("companyNotFound")} />
        ) : error ? (
          <ContextualError
            message={apiErrorText(error, t, t("couldNotLoadCompany"))}
            onRetry={reload}
          />
        ) : (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-40 w-full rounded-surface" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </PageLayout>
    );
  }
  return <CompanyView company={data} context={back} />;
}

export function CompanyView({ company, context }: { company: Company; context: React.ReactNode }) {
  const { t, language } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const { data: event } = useServerResource(["public", "event"], () => getPublicEvent());
  const zone = event?.timezone;
  const clock = eventDateFormat(language, "clock", zone);
  const weekdayShort = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: zone });
  const description = companyDescription(company, language);
  const long = (description?.length ?? 0) > 280;

  return (
    <>
      <HeroBleed color={null} ambient={companyAmbient(company)} className="space-y-5">
        {context}
        <header className="flex flex-col items-center gap-4 pt-4 text-center sm:flex-row sm:gap-8 sm:text-left">
          <div className="flex size-28 shrink-0 items-center justify-center rounded-surface bg-white p-4 shadow-md sm:size-44 dark:bg-card">
            {company.logoUrl ? (
              <SponsorLogo
                logoUrl={company.logoUrl}
                logoNegativeUrl={company.logoNegativeUrl}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-4xl font-medium text-muted-foreground">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 space-y-2">
            <h1 className="font-display text-3xl leading-tight wrap-anywhere sm:text-5xl">
              {company.name}
            </h1>
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="button-interaction type-meta -mx-2 -my-1 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1"
              >
                <span className="truncate">{socialLinkText(company.website)}</span>
                <ArrowSquareOutIcon aria-hidden="true" className="size-4 shrink-0" />
              </a>
            )}
          </div>
        </header>
      </HeroBleed>
      <PageLayout width="reading">
        {description && (
          <div className="space-y-1">
            <p
              className={
                expanded || !long
                  ? "max-w-prose whitespace-pre-line wrap-anywhere text-pretty"
                  : "line-clamp-4 max-w-prose wrap-anywhere text-pretty"
              }
            >
              {description}
            </p>
            {long && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t("showLess") : t("more")}
              </Button>
            )}
          </div>
        )}
        {company.representatives.length > 0 && (
          <section
            aria-labelledby="company-representatives"
            className="space-y-3 border-t border-border/60 pt-5"
          >
            <h2
              id="company-representatives"
              className="type-meta font-medium text-muted-foreground"
            >
              {t("companyRepresentatives")}
            </h2>
            <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {company.representatives.map((person) => (
                <li key={person.userId} className="min-w-0">
                  <Link
                    href={`/people/${person.userId}?company=${company.id}`}
                    className="row-link flex min-w-0 items-center gap-3 py-2"
                  >
                    <UserAvatar
                      userId={person.userId}
                      name={person.name}
                      image={person.avatarUrl}
                      className="size-10"
                      decorative
                    />
                    <span className="min-w-0 truncate text-sm font-medium">{person.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {company.challenges.length > 0 && (
          <section
            aria-labelledby="company-challenges"
            className="space-y-3 border-t border-border/60 pt-5"
          >
            <h2 id="company-challenges" className="type-meta font-medium text-muted-foreground">
              {t("challenges")}
            </h2>
            <ul className="divide-y divide-border/60">
              {company.challenges.map((challenge) => (
                <li key={challenge.id}>
                  <Link
                    href={`/challenge/${challenge.id}`}
                    className="row-link group flex items-center gap-4 py-3"
                  >
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="block font-medium">{challenge.title}</span>
                      {challenge.summary && (
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {challenge.summary}
                        </span>
                      )}
                    </span>
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {company.activities.length > 0 && (
          <section
            aria-labelledby="company-activities"
            className="space-y-3 border-t border-border/60 pt-5"
          >
            <h2 id="company-activities" className="type-meta font-medium text-muted-foreground">
              {t("activities")}
            </h2>
            <ul className="divide-y divide-border/60">
              {company.activities.map((activity) => (
                <li key={activity.id}>
                  <Link
                    href={`/timetable?activity=${activity.id}`}
                    className="row-link grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 min-w-12 shrink-0 flex-col px-1.5 items-center justify-center rounded-lg border border-border/60 leading-none">
                        <span className="text-[0.625rem] font-medium text-muted-foreground uppercase">
                          {weekdayShort.format(new Date(activity.startsAt))}
                        </span>
                        <span className="text-base font-medium">
                          {clock.format(new Date(activity.startsAt))}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{activity.title}</span>
                        {activity.location && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {activity.location}
                          </span>
                        )}
                      </span>
                    </span>
                    <SpeakerStack speakers={activity.speakers ?? []} max={3} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageLayout>
    </>
  );
}
