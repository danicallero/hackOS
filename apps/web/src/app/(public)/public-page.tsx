"use client";

import { CalendarDaysIcon, MegaphoneIcon, TrophyIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { Spinner } from "@/components/common/spinner";
import type {
  PublicAnnouncement,
  PublicChallenge,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { displayText } from "@/components/public/public-types";
import { EventTimer } from "@/components/public/timer";
import { api } from "@/lib/api";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";

type Content = {
  event: PublicEvent;
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  challenges: PublicChallenge[];
  announcements: PublicAnnouncement[];
};

const dateTime = (value: string, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));

export function PublicPage() {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [event, schedule, sponsorResult, challengeResult, announcementResult] =
        await Promise.all([
          api.get<PublicEvent>("/api/public/event"),
          logisticsApi.publicSchedule(),
          api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
          api.get<{ items: PublicChallenge[] }>("/api/public/challenges"),
          api.get<{ items: PublicAnnouncement[] }>("/api/announcements/public"),
        ]);
      setContent({
        event,
        schedule: schedule.items,
        sponsors: sponsorResult.items,
        challenges: challengeResult.items,
        announcements: announcementResult.items,
      });
      setError(null);
    } catch {
      setError("The public event information is temporarily unavailable.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!content && !error)
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-busy="true">
        <Spinner className="size-7" />
        <span className="sr-only">Loading public event information</span>
      </div>
    );
  if (!content)
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-medium">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      </div>
    );
  const { event, schedule, sponsors, challenges, announcements } = content;
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-6 border-b pb-6">
        <Brand />
        <a className="text-sm underline underline-offset-4" href="/login">
          Staff sign in
        </a>
      </header>
      <section className="py-14 sm:py-20">
        <p className="text-muted-foreground text-sm font-medium">Welcome to</p>
        <h1 className="text-balance mt-2 text-4xl font-semibold sm:text-6xl">
          {event.name ?? "hackOS"}
        </h1>
        {event.tagline && (
          <p className="text-muted-foreground text-pretty mt-4 max-w-2xl text-lg">
            {event.tagline}
          </p>
        )}
        {event.hackingEndsAt && (
          <div className="mt-8">
            <p className="text-muted-foreground text-sm">Time remaining</p>
            <EventTimer
              endsAt={event.hackingEndsAt}
              className="mt-1 block font-mono text-4xl font-semibold tabular-nums sm:text-5xl"
            />
          </div>
        )}
      </section>
      {announcements.length > 0 && (
        <section aria-labelledby="announcements-title" className="border-y py-8">
          <div className="flex items-center gap-2">
            <MegaphoneIcon className="size-5" aria-hidden="true" />
            <h2 id="announcements-title" className="text-balance text-2xl font-semibold">
              Announcements
            </h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {announcements.map((item) => (
              <article key={item.id} className="rounded-lg border p-5">
                <h3 className="font-medium">{item.title}</h3>
                <p className="text-muted-foreground text-pretty mt-2 whitespace-pre-wrap text-sm">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="schedule-title" className="py-12">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="size-5" aria-hidden="true" />
          <h2 id="schedule-title" className="text-balance text-2xl font-semibold">
            Schedule
          </h2>
        </div>
        {schedule.length ? (
          <ol className="mt-5 divide-y border-y">
            {schedule.map((item) => (
              <li key={item.id} className="grid gap-1 py-4 sm:grid-cols-[12rem_1fr_auto] sm:gap-4">
                <time className="text-muted-foreground text-sm tabular-nums">
                  {dateTime(item.startsAt, event.timezone)}
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
          <p className="text-muted-foreground mt-5">The schedule will be published soon.</p>
        )}
      </section>
      <section aria-labelledby="challenges-title" className="border-t py-12">
        <div className="flex items-center gap-2">
          <TrophyIcon className="size-5" aria-hidden="true" />
          <h2 id="challenges-title" className="text-balance text-2xl font-semibold">
            Challenges and prizes
          </h2>
        </div>
        {challenges.length ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {challenges.map((challenge) => (
              <article key={challenge.id} className="rounded-lg border p-5">
                <p className="text-muted-foreground text-sm">{challenge.enterprise.name}</p>
                <h3 className="mt-1 text-lg font-medium">{displayText(challenge.title)}</h3>
                <p className="text-muted-foreground text-pretty mt-2 text-sm">
                  {displayText(challenge.description)}
                </p>
                {Array.isArray(challenge.prizes) && challenge.prizes.length > 0 && (
                  <p className="mt-3 text-sm font-medium">Prizes available</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-5">Challenges will be published soon.</p>
        )}
      </section>
      <section aria-labelledby="sponsors-title" className="border-t py-12">
        <h2 id="sponsors-title" className="text-balance text-2xl font-semibold">
          Sponsors
        </h2>
        {sponsors.length ? (
          <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {sponsors.map((sponsor) => (
              <li
                key={sponsor.id}
                className="flex min-h-28 items-center justify-center rounded-lg border p-5 text-center"
              >
                {sponsor.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: sponsor logos use the deployment-configured public object-store host.
                  <img
                    src={sponsor.logoUrl}
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
          <p className="text-muted-foreground mt-5">Sponsors will be announced soon.</p>
        )}
      </section>
    </div>
  );
}
