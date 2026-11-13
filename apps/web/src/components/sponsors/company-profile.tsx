"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import Link from "next/link";
import { useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
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
  fetchCompanyProfile,
  heroGradient,
  useLogoColor,
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
  const logoColor = useLogoColor(company.logoUrl);
  const { data: event } = useServerResource(["public", "event"], () => getPublicEvent());
  const zone = event?.timezone;
  const day = eventDateFormat(language, "weekdayDayMonthText", zone);
  const clock = eventDateFormat(language, "clock", zone);
  const long = (company.description?.length ?? 0) > 280;

  return (
    <PageLayout width="reading">
      <div className="space-y-5">
        {context}
        <header
          className="-mx-1 flex flex-col gap-4 rounded-surface p-5 [--hero-mix:35%] sm:flex-row sm:items-center dark:[--hero-mix:22%]"
          style={{ backgroundImage: heroGradient(logoColor) }}
        >
          <div className="flex size-24 shrink-0 items-center justify-center rounded-surface bg-white p-3 shadow-sm dark:bg-card">
            {company.logoUrl ? (
              <SponsorLogo
                logoUrl={company.logoUrl}
                logoNegativeUrl={company.logoNegativeUrl}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-2xl font-medium text-muted-foreground">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <h1 className="type-page-title wrap-anywhere">{company.name}</h1>
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="button-interaction type-meta inline-flex max-w-full items-center gap-1 rounded-sm underline-offset-4 hover:underline"
              >
                <span className="truncate">{socialLinkText(company.website)}</span>
                <ArrowSquareOutIcon aria-hidden="true" className="size-4 shrink-0" />
              </a>
            )}
          </div>
        </header>
      </div>
      {company.description && (
        <div className="space-y-1">
          <p
            className={
              expanded || !long
                ? "max-w-prose whitespace-pre-line wrap-anywhere text-pretty"
                : "line-clamp-4 max-w-prose wrap-anywhere text-pretty"
            }
          >
            {company.description}
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
        <section aria-labelledby="company-representatives" className="space-y-2">
          <h2 id="company-representatives" className="type-subheading">
            {t("companyRepresentatives")}
          </h2>
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {company.representatives.map((person) => (
              <li key={person.userId} className="min-w-0">
                <Link
                  href={`/people/${person.userId}`}
                  className="button-interaction -mx-1 flex min-w-0 items-center gap-3 rounded-sm px-1 py-1 hover:bg-muted"
                >
                  <UserAvatar
                    name={person.name}
                    image={person.avatarUrl}
                    className="size-10"
                    showInitials
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
        <section aria-labelledby="company-challenges" className="space-y-2">
          <h2 id="company-challenges" className="type-subheading">
            {t("challenges")}
          </h2>
          <ul className="divide-y divide-border/60">
            {company.challenges.map((challenge) => (
              <li key={challenge.id}>
                <Link
                  href={`/challenge/${challenge.id}`}
                  className="button-interaction -mx-1 block rounded-sm px-1 py-2 hover:bg-muted"
                >
                  <span className="block text-sm font-medium">{challenge.title}</span>
                  {challenge.summary && (
                    <span className="line-clamp-2 block text-sm text-muted-foreground">
                      {challenge.summary}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {company.activities.length > 0 && (
        <section aria-labelledby="company-activities" className="space-y-2">
          <h2 id="company-activities" className="type-subheading">
            {t("activities")}
          </h2>
          <ul className="divide-y divide-border/60">
            {company.activities.map((activity) => (
              <li key={activity.id}>
                <Link
                  href={`/timetable?activity=${activity.id}`}
                  className="button-interaction -mx-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm px-1 py-2 hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{activity.title}</span>
                    <span className="block truncate text-xs text-muted-foreground capitalize">
                      {day.format(new Date(activity.startsAt))} ·{" "}
                      {clock.format(new Date(activity.startsAt))}
                      {activity.location ? ` · ${activity.location}` : ""}
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
  );
}
