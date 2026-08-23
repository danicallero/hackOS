"use client";

import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  MegaphoneIcon,
  TrophyIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { LanguageSelect } from "@/components/common/language-select";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { ThemeToggle } from "@/components/common/theme-toggle";
import type {
  PublicAnnouncement,
  PublicApplicationForm,
  PublicChallenge,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { displayText } from "@/components/public/public-types";
import { EventPhaseDisplay, useEventPhase } from "@/components/public/timer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

type Content = {
  event: PublicEvent;
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  challenges: PublicChallenge[];
  screenAnnouncements: PublicAnnouncement[];
  openApplications: PublicApplicationForm[];
};

const dateTime = (value: string, timezone: string, language: "es" | "gl" | "en") =>
  new Intl.DateTimeFormat(LOCALE_CODES[language], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));

function applicationTypeLabel(type: string, t: Translate): string {
  return (
    (
      {
        participant: t("applicationTypeParticipant"),
        mentor: t("applicationTypeMentor"),
        sponsor: t("applicationTypeSponsor"),
        volunteer: t("applicationTypeVolunteer"),
      } as Record<string, string>
    )[type] ?? t("applicationTypeOther")
  );
}

export function PublicPage() {
  const { language, t } = useLocale();
  // The landing page is worth visiting whether or not you're signed in
  // already (schedule, challenges, sponsors), so its entry point should never
  // read "Log in" to someone who already has a session — send them straight
  // into the app instead of back through the sign-in form.
  const { status } = useSessionContext();
  const appHref = status === "authenticated" ? "/timetable" : "/login";
  const appLabel = status === "authenticated" ? t("goToApp") : t("logIn");
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [
        event,
        schedule,
        sponsorResult,
        challengeResult,
        announcementResult,
        applicationResult,
      ] = await Promise.all([
        api.get<PublicEvent>("/api/public/event"),
        logisticsApi.publicSchedule(),
        api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
        api.get<{ items: PublicChallenge[] }>("/api/public/challenges"),
        api.get<{ items: PublicAnnouncement[] }>("/api/announcements/public"),
        api.get<{ applications: PublicApplicationForm[] }>("/api/public/applications"),
      ]);
      setContent({
        event,
        schedule: schedule.items,
        sponsors: sponsorResult.items,
        challenges: challengeResult.items,
        // Only announcements actually being shown on a venue screen right now
        // (H50/H41-H42) belong on the public site — everything else on this
        // feed exists purely for notification delivery, never for display.
        screenAnnouncements: announcementResult.items.filter(
          (item) => item.screenPlacement && item.screenPlacement !== "none",
        ),
        openApplications: applicationResult.applications,
      });
      setError(null);
    } catch {
      setError(t("publicEventUnavailable"));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  // The browser tab should read the configured event's name, not a generic
  // product title, once it's loaded.
  useEffect(() => {
    if (content?.event.name) document.title = content.event.name;
  }, [content]);
  return (
    <div className="relative overflow-x-clip">
      {/* Decorative glow, purely cosmetic — sits behind all content. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-primary/10 absolute -top-32 -left-32 size-[28rem] rounded-full blur-3xl" />
        <div className="bg-chart-2/10 absolute top-40 -right-24 size-[24rem] rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <header className="flex items-center justify-between gap-2 py-5 sm:py-6">
          <Brand />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <LanguageSelect />
            <ThemeToggle />
            <Button size="sm" asChild className="hidden sm:inline-flex">
              <Link href={appHref}>
                {appLabel}
                <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          </div>
        </header>

        {!content && !error && (
          <div className="grid py-24" role="status" aria-busy="true">
            <div className="mx-auto">
              <Spinner className="size-7" />
              <span className="sr-only">{t("loadingPublicEventInfo")}</span>
            </div>
          </div>
        )}

        {!content && error && (
          <div className="border-t py-16 text-center">
            <p className="text-muted-foreground font-medium">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 underline underline-offset-4"
            >
              {t("tryAgain")}
            </button>
          </div>
        )}

        {content && (
          <PublicPageContent
            content={content}
            language={language}
            t={t}
            appHref={appHref}
            appLabel={appLabel}
          />
        )}

        <footer className="text-muted-foreground border-t py-8 text-center text-xs">
          <nav
            aria-label={t("legalLinksLabel")}
            className="flex flex-wrap justify-center gap-x-4 gap-y-2"
          >
            <Link className="underline underline-offset-4 hover:text-foreground" href="/terms">
              {t("termsAndConditions")}
            </Link>
            <Link className="underline underline-offset-4 hover:text-foreground" href="/privacy">
              {t("privacyPolicy")}
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

function PublicPageContent({
  content,
  language,
  t,
  appHref,
  appLabel,
}: {
  content: Content;
  language: "es" | "gl" | "en";
  t: Translate;
  appHref: string;
  appLabel: string;
}) {
  const { event, schedule, sponsors, challenges, screenAnnouncements, openApplications } = content;
  const upcomingSchedule = schedule
    .filter((item) => Date.parse(item.endsAt) >= Date.now())
    .slice(0, 4);
  const eventPhase = useEventPhase(event);
  return (
    <>
      <section className="py-12 sm:py-24">
        <h1 className="text-balance break-words text-4xl font-semibold tracking-tight sm:text-6xl">
          {event.name ?? "hackOS"}
        </h1>
        {event.tagline && (
          <p className="text-muted-foreground text-pretty mt-4 max-w-2xl text-lg">
            {event.tagline}
          </p>
        )}
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {openApplications.length > 0 && (
            <Button size="lg" asChild>
              <Link href={withReturnPath("/signup", "/my-applications")}>
                {t("applyNow")}
                <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          )}
          <Button size="lg" variant="outline" asChild>
            <Link href={appHref}>{appLabel}</Link>
          </Button>
        </div>
        {eventPhase.kind !== "none" && (
          <div className="border-primary/20 bg-card/60 mt-10 inline-flex max-w-full flex-col rounded-xl border p-4 shadow-sm backdrop-blur sm:p-5">
            <EventPhaseDisplay
              phase={eventPhase}
              className="mt-1 block font-mono text-3xl font-semibold tabular-nums sm:text-5xl"
            />
          </div>
        )}
      </section>

      {openApplications.length > 0 && (
        <section aria-labelledby="applications-title" className="border-t py-12">
          <SectionHeading icon={ClipboardListIcon} id="applications-title">
            {t("openApplications")}
          </SectionHeading>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {openApplications.map((form) => (
              <div
                key={form.id}
                className="hover:border-primary/30 flex items-center justify-between gap-4 rounded-xl border p-5 transition-colors"
              >
                <div className="min-w-0">
                  <h3 className="font-medium">{form.name}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    <span>{applicationTypeLabel(form.type, t)}</span>
                    {form.close_at
                      ? ` · ${t("closes")} ${dateTime(form.close_at, event.timezone, language)}`
                      : ""}
                  </p>
                </div>
                <Button asChild size="sm">
                  {/* Selecting a specific form survives account creation and
                      verification (H188): land directly back on this form. */}
                  <Link href={withReturnPath("/signup", `/my-applications/${form.id}`)}>
                    {t("apply")}
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {screenAnnouncements.length > 0 && (
        <section aria-labelledby="announcements-title" className="border-t py-12">
          <SectionHeading icon={MegaphoneIcon} id="announcements-title">
            {t("publicAnnouncements")}
          </SectionHeading>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {screenAnnouncements.map((item) => (
              <article
                key={item.id}
                className="hover:border-primary/30 rounded-xl border p-5 shadow-sm transition-colors hover:shadow-md"
              >
                <h3 className="font-medium">{item.title}</h3>
                <p className="text-muted-foreground text-pretty mt-2 wrap-anywhere whitespace-pre-wrap text-sm">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="schedule-title" className="border-t py-12">
        <SectionHeading icon={CalendarDaysIcon} id="schedule-title">
          {t("publicSchedule")}
        </SectionHeading>
        {upcomingSchedule.length ? (
          <ol className="mt-6 divide-y overflow-hidden rounded-xl border">
            {upcomingSchedule.map((item) => (
              <li
                key={item.id}
                className="hover:bg-accent/50 grid gap-1 p-4 transition-colors sm:grid-cols-[12rem_1fr_auto] sm:gap-4"
              >
                <time className="text-muted-foreground text-sm tabular-nums">
                  {dateTime(item.startsAt, event.timezone, language)}
                </time>
                <div>
                  <h3 className="font-medium">{item.title}</h3>
                  {item.description && (
                    <p className="text-muted-foreground text-pretty mt-1 text-sm">
                      {item.description}
                    </p>
                  )}
                </div>
                {item.location && <p className="text-muted-foreground text-sm">{item.location}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyNotice>
            {schedule.length ? t("scheduleNoUpcoming") : t("schedulePending")}
          </EmptyNotice>
        )}
        {schedule.length > 0 && (
          <Button asChild variant="outline" className="mt-4">
            <Link href="/horario">
              {t("viewSchedule")}
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </section>

      <section aria-labelledby="challenges-title" className="border-t py-12">
        <SectionHeading icon={TrophyIcon} id="challenges-title">
          {t("challengesAndPrizes")}
        </SectionHeading>
        {challenges.length ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {challenges.map((challenge) => (
              <Link
                key={challenge.id}
                href={`/challenge/${challenge.id}`}
                className="hover:border-primary/30 block rounded-xl border p-5 shadow-sm transition-colors hover:shadow-md"
              >
                <p className="text-muted-foreground text-sm">{challenge.enterprise.name}</p>
                <h3 className="mt-1 text-lg font-medium">
                  {displayText(challenge.title, language)}
                </h3>
                <p className="text-muted-foreground text-pretty mt-2 line-clamp-3 text-sm">
                  {displayText(challenge.description, language)}
                </p>
                {Array.isArray(challenge.prizes) && challenge.prizes.length > 0 && (
                  <p className="text-primary mt-3 text-sm font-medium">{t("prizesAvailable")}</p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyNotice>{t("challengesPending")}</EmptyNotice>
        )}
      </section>

      <section aria-labelledby="sponsors-title" className="border-t py-12">
        <h2 id="sponsors-title" className="text-balance text-2xl font-semibold">
          {t("sponsors")}
        </h2>
        {sponsors.length ? (
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {sponsors.map((sponsor) => (
              <li
                key={sponsor.enterpriseId}
                className="hover:border-primary/30 flex min-h-28 items-center justify-center rounded-xl border p-5 text-center shadow-sm transition-colors hover:shadow-md"
              >
                {sponsor.logoUrl ? (
                  <SponsorLogo
                    logoUrl={sponsor.logoUrl}
                    logoNegativeUrl={sponsor.logoNegativeUrl}
                    alt={sponsor.name}
                    className="max-h-16 max-w-full object-contain"
                  />
                ) : (
                  <span className="font-medium">{sponsor.name}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNotice>{t("sponsorsPending")}</EmptyNotice>
        )}
      </section>
    </>
  );
}

function SectionHeading({
  icon: Icon,
  id,
  children,
}: {
  icon: typeof CalendarDaysIcon;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-primary/10 text-primary grid size-8 place-items-center rounded-full">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h2 id={id} className="text-balance text-2xl font-semibold">
        {children}
      </h2>
    </div>
  );
}

function EmptyNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mt-6 rounded-xl border border-dashed p-6 text-center text-sm">
      {children}
    </p>
  );
}
