"use client";

import { useEffect, useState } from "react";
import { type SocialSharingEvent, useShareImage } from "@/components/onboarding/social-sharing";
import { formatEventDate } from "@/lib/datetime";
import { EVENT_CITY, EVENT_PUBLIC_URL } from "@/lib/event-brand";
import { useLocale } from "@/lib/i18n";
import { getPublicEvent } from "@/lib/public-content";
import type { PublicEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

// The share card's event facts (public feed, no session needed) and its
// read-only preview. Kept apart from the onboarding steps so public pages
// such as the confirmation landing don't pull in the whole journey.

/** The public event feed: name, tagline and dates exactly as the organizer configured them. */
export function useEventFacts(): PublicEvent | null {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  useEffect(() => {
    let active = true;
    getPublicEvent()
      .then((value) => active && setEvent(value))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return event;
}

/** Whole hours of the hacking window ("36 hours of development"); undefined without a window. */
export function hackingHours(
  event: Pick<PublicEvent, "hackingStartsAt" | "hackingEndsAt"> | null,
): number | undefined {
  if (!event?.hackingStartsAt || !event.hackingEndsAt) return undefined;
  const ms = Date.parse(event.hackingEndsAt) - Date.parse(event.hackingStartsAt);
  return ms > 0 ? Math.round(ms / 3_600_000) : undefined;
}

/** "5 Jan 2026" or "5 Jan – 7 Jan 2026", only from configured instants; "" when unset. */
export function eventDateRange(
  event: Pick<PublicEvent, "hackingStartsAt" | "hackingEndsAt" | "timezone"> | null,
  language: "es" | "gl" | "en",
): string {
  if (!event?.hackingStartsAt) return "";
  const start = formatEventDate(event.hackingStartsAt, language, "date", event.timezone);
  const end = event.hackingEndsAt
    ? formatEventDate(event.hackingEndsAt, language, "date", event.timezone)
    : "";
  return end && end !== start ? `${start} – ${end}` : start;
}

/** The event as the share card prints it, from the public feed; null until it loads. */
export function useShareEvent(): SocialSharingEvent | null {
  const { language } = useLocale();
  const event = useEventFacts();
  if (!event?.name) return null;
  const year = event.hackingStartsAt
    ? formatEventDate(event.hackingStartsAt, language, "date", event.timezone).slice(-4)
    : "";
  return {
    name: event.name,
    year: /^\d{4}$/.test(year) ? year : "",
    dateLabel: eventDateRange(event, language) || undefined,
    location: EVENT_CITY,
    url: EVENT_PUBLIC_URL,
    hours: hackingHours(event),
    dates:
      event.hackingStartsAt && event.hackingEndsAt
        ? { start: event.hackingStartsAt, end: event.hackingEndsAt, timezone: event.timezone }
        : undefined,
  };
}

/**
 * H15: a look at the card someone gets to share, drawn with their own name,
 * before they are signed in (the confirmation landing). Decorative: hidden
 * while it loads or if drawing fails, so it never stands between the person
 * and the next step.
 */
export function ShareCardPreview({ name, className }: { name: string; className?: string }) {
  const event = useShareEvent();
  if (!event) return null;
  return <ShareCardPreviewImage event={event} name={name} className={className} />;
}

function ShareCardPreviewImage({
  event,
  name,
  className,
}: {
  event: SocialSharingEvent;
  name: string;
  className?: string;
}) {
  const { render } = useShareImage(event, { displayName: name }, "landscape");
  if (render.status !== "ready") return null;
  return (
    // biome-ignore lint/performance/noImgElement: a generated blob URL, not an optimisable asset.
    <img
      src={render.url}
      alt=""
      className={cn("aspect-[1200/630] w-full rounded-surface border object-contain", className)}
    />
  );
}
