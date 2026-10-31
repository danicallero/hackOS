"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { MegaphoneIcon } from "@phosphor-icons/react/dist/csr/Megaphone";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { HomeOverview } from "@/components/public/home-overview";
import type {
  PublicAnnouncement,
  PublicApplicationForm,
  PublicChallenge,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { displayText } from "@/components/public/public-types";
import { SponsorGrid } from "@/components/public/sponsor-grid";
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
  collaborators: PublicSponsor[];
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

/**
 * H8: label for a public form's `granted_role_name` — the name of its
 * highest-position granted role, or null if it grants none. Replaces the
 * retired static `type` field's display.
 */
function grantedRoleNameLabel(roleName: string | null, t: Translate): string {
  return roleName ?? t("roleUnassigned");
}

export function PublicPage({ embedded = false }: { embedded?: boolean }) {
  const { language, t } = useLocale();
  // The landing page is worth visiting whether or not you're signed in
  // already (schedule, challenges, sponsors), so its entry point should never
  // read "Log in" to someone who already has a session — send them straight
  // into the app instead of back through the sign-in form.
  const { status } = useSessionContext();
  const appHref = status === "authenticated" ? "/event" : "/login";
  const appLabel = status === "authenticated" ? t("goToApp") : t("logIn");
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track "now" as ticking state for schedule filtering purity (60s refresh).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
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
        embedded ? Promise.resolve({ items: [] }) : logisticsApi.publicSchedule(),
        api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
        api.get<{ items: PublicChallenge[] }>("/api/public/challenges"),
        api.get<{ items: PublicAnnouncement[] }>("/api/announcements/public"),
        embedded
          ? Promise.resolve({ applications: [] })
          : api.get<{ applications: PublicApplicationForm[] }>("/api/public/applications"),
      ]);
      setContent({
        event,
        schedule: schedule.items,
        sponsors: sponsorResult.items.filter((item) => item.kind !== "collaborator"),
        collaborators: sponsorResult.items.filter((item) => item.kind === "collaborator"),
        challenges: challengeResult.items,
        // Only announcements actually being shown on a venue screen right now
        // (H50/H41-H42) belong on the public site — everything else on this
        // feed exists purely for notification delivery, never for display.
        screenAnnouncements: announcementResult.items.filter(
          (item) => item.screenPlacement !== "none",
        ),
        openApplications: applicationResult.applications,
      });
      setError(null);
    } catch {
      setError(t("publicEventUnavailable"));
    }
  }, [embedded, t]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  // The browser tab should read the configured event's name, not a generic
  // product title, once it's loaded.
  useEffect(() => {
    if (content?.event.name) document.title = content.event.name;
  }, [content]);
  const Landmark = embedded ? "div" : "main";
  return (
    <div className="relative overflow-x-clip">
      {!embedded && <PublicTopBar />}
      {/* Embedded in the app shell, whose canvas is already the page's only <main> (#1172). */}
      <Landmark
        id={embedded ? undefined : "main-content"}
        tabIndex={embedded ? undefined : -1}
        className={embedded ? undefined : "mx-auto max-w-7xl px-4 outline-none sm:px-6"}
      >
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
              className="button-interaction mt-4 underline underline-offset-4"
            >
              {t("tryAgain")}
            </button>
          </div>
        )}

        {content &&
          (embedded ? (
            <HomeOverview {...content} />
          ) : (
            <PublicPageContent
              content={content}
              language={language}
              t={t}
              appHref={appHref}
              appLabel={appLabel}
              now={now}
            />
          ))}
      </Landmark>
      {!embedded && <PublicFooter />}
    </div>
  );
}

function PublicPageContent({
  content,
  language,
  t,
  appHref,
  appLabel,
  now,
}: {
  content: Content;
  language: "es" | "gl" | "en";
  t: Translate;
  appHref: string;
  appLabel: string;
  now: number;
}) {
  const {
    event,
    schedule,
    sponsors,
    collaborators,
    challenges,
    screenAnnouncements,
    openApplications,
  } = content;
  const upcomingSchedule = schedule.filter((item) => Date.parse(item.endsAt) >= now).slice(0, 4);
  const eventPhase = useEventPhase(event);
  return (
    <>
      <section className="py-12 sm:py-24">
        <h1 className="text-balance wrap-break-word font-display text-4xl font-normal sm:text-6xl">
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
                <ArrowRightIcon aria-hidden="true" className="size-4" />
              </Link>
            </Button>
          )}
          <Button size="lg" variant="outline" asChild>
            <Link href={appHref}>{appLabel}</Link>
          </Button>
        </div>
        {eventPhase.kind !== "none" && (
          <div className="border-border bg-card mt-10 inline-flex max-w-full flex-col rounded-surface border p-4 sm:p-5">
            <EventPhaseDisplay
              phase={eventPhase}
              className="mt-1 block font-mono text-3xl font-semibold tabular-nums sm:text-5xl"
            />
          </div>
        )}
      </section>

      {openApplications.length > 0 && (
        <section aria-labelledby="applications-title" className="border-t py-12">
          <SectionHeading icon={ClipboardTextIcon} id="applications-title">
            {t("openApplications")}
          </SectionHeading>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {openApplications.map((form) => (
              <div
                key={form.id}
                className="hover:border-primary/30 flex items-center justify-between gap-4 rounded-surface border p-5 transition-colors"
              >
                <div className="min-w-0">
                  <h3 className="font-medium">{form.name}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    <span>{grantedRoleNameLabel(form.granted_role_name, t)}</span>
                    {form.close_at
                      ? ` · ${t("closes")} ${dateTime(form.close_at, event.timezone, language)}`
                      : ""}
                  </p>
                </div>
                <Button asChild size="sm">
                  {/* Selecting a specific form survives account creation and
                      verification (#188): land directly back on this form. */}
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
                className="hover:border-primary/30 rounded-surface border p-5 transition-colors"
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
        <SectionHeading icon={CalendarDotsIcon} id="schedule-title">
          {t("publicSchedule")}
        </SectionHeading>
        {upcomingSchedule.length ? (
          <ol className="mt-6 divide-y overflow-hidden rounded-surface border">
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
            <Link href="/timetable">
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
          <div className="mt-6 grid auto-rows-fr gap-4 md:grid-cols-2">
            {challenges.map((challenge) => (
              <SectionCard
                key={challenge.id}
                className="flex h-full flex-col"
                bodyClassName="flex-1"
                icon={TrophyIcon}
                title={displayText(challenge.title, language)}
                footer={
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/challenge/${challenge.id}`}
                      aria-label={`${t("viewChallenge")}: ${displayText(challenge.title, language)}`}
                    >
                      {t("viewChallenge")}
                      <ArrowRightIcon aria-hidden="true" />
                    </Link>
                  </Button>
                }
              >
                <p className="text-muted-foreground text-sm">{challenge.enterprise.name}</p>
                <p className="text-muted-foreground text-pretty mt-2 line-clamp-3 text-sm">
                  {displayText(challenge.description, language)}
                </p>
                {Array.isArray(challenge.prizes) && challenge.prizes.length > 0 && (
                  <p className="text-primary mt-3 text-sm font-medium">{t("prizesAvailable")}</p>
                )}
              </SectionCard>
            ))}
          </div>
        ) : (
          <EmptyNotice>{t("challengesPending")}</EmptyNotice>
        )}
      </section>

      <section aria-labelledby="gallery-title" className="border-t py-12">
        <SectionHeading icon={FolderSimpleIcon} id="gallery-title">
          {t("projectGallery")}
        </SectionHeading>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/gallery">
            {t("projectGallery")}
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </section>

      <section aria-labelledby="sponsors-title" className="border-t py-12">
        <h2 id="sponsors-title" className="text-balance font-display text-2xl font-normal">
          {t("sponsors")}
        </h2>
        {sponsors.length ? (
          <SponsorGrid sponsors={sponsors} className="mt-6" />
        ) : (
          <EmptyNotice>{t("sponsorsPending")}</EmptyNotice>
        )}
      </section>

      {collaborators.length > 0 && (
        <section aria-labelledby="collaborators-title" className="border-t py-12">
          <h2 id="collaborators-title" className="text-balance font-display text-2xl font-normal">
            {t("collaborators")}
          </h2>
          <SponsorGrid sponsors={collaborators} className="mt-6" />
        </section>
      )}
    </>
  );
}

function SectionHeading({
  icon: Icon,
  id,
  children,
}: {
  icon: typeof CalendarDotsIcon;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="bg-primary/10 text-primary grid size-8 place-items-center rounded-full">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <h2 id={id} className="text-balance font-display text-2xl font-normal">
        {children}
      </h2>
    </div>
  );
}

function EmptyNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mt-6 rounded-surface border border-dashed p-6 text-center text-sm">
      {children}
    </p>
  );
}
