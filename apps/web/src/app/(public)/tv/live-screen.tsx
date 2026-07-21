"use client";

import { WifiIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PublicEvent, PublicSponsor } from "@/components/public/public-types";
import { EventPhaseDisplay, EventTimer, useEventPhase } from "@/components/public/timer";
import { useElementSize } from "@/hooks/use-element-size";
import { useLocale } from "@/lib/i18n";
import type { PublicScheduleItem } from "@/lib/logistics";
import {
  bestSponsorColumns,
  type LiveScreenConfig,
  resolveTimer,
  type TvVenueConfig,
  upcomingWindow,
} from "@/lib/tv";
import { cn } from "@/lib/utils";
import { MarqueeText } from "./marquee-text";
import { SponsorMark } from "./sponsor-mark";
import { TvHeader, TvScreen } from "./tv-screen";
import { WifiQr } from "./wifi-qr";

/**
 * The everyday screen (H42): one view combining the countdown, what's coming
 * up, who's sponsoring and how to get online — so the wall says something
 * useful for the 90% of the event that isn't judging, with nobody switching
 * modes. Each block is individually toggleable from the TV control page; a
 * hidden block gives its space to the others rather than leaving a hole.
 */

/**
 * Rows grow into the space the block has, between these bounds: below the
 * floor they crowd, above the ceiling a tall portrait screen turns six
 * activities into six widely-spaced islands.
 */
const SCHEDULE_ROW_MIN_EM = 3.6;
const SCHEDULE_ROW_MAX_EM = 5.5;

/** Matches the `gap-[0.75em]` on the sponsor grid at the 1x scale it is measured against. */
const SPONSOR_GAP_PX = 12;
const SCHEDULE_TICK_MS = 20_000;

/**
 * How much of the hacking window is gone, 0..1 — null when the window isn't
 * configured or the countdown is pointing somewhere else entirely.
 */
function hackingProgress(event: PublicEvent | null, now: number): number | null {
  const start = event?.hackingStartsAt ? new Date(event.hackingStartsAt).getTime() : null;
  const end = event?.hackingEndsAt ? new Date(event.hackingEndsAt).getTime() : null;
  if (start === null || end === null || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

function Countdown({
  config,
  event,
  showProgress,
}: {
  config: LiveScreenConfig;
  event: PublicEvent | null;
  showProgress: boolean;
}) {
  const { t } = useLocale();
  const phase = useEventPhase(event);
  const resolved = resolveTimer(config, event);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const progress = showProgress ? hackingProgress(event, now) : null;

  // Not `leading-none`: the frame clips overflow, and a line box exactly as
  // tall as the glyphs shaves anything with a descender or accent.
  const timeClassName =
    "block font-mono text-[8em] leading-[1.05] font-semibold tracking-[-0.02em] tabular-nums";
  const labelClassName =
    "text-muted-foreground max-w-full text-[1.25em] font-medium tracking-[0.18em] text-balance uppercase";

  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-[0.5em] text-center">
      {resolved.kind === "fixed" ? (
        <>
          <p className={labelClassName}>{resolved.label ?? t("timeRemaining")}</p>
          <EventTimer endsAt={resolved.endsAt} className={timeClassName} />
        </>
      ) : (
        <EventPhaseDisplay
          phase={phase}
          className={timeClassName}
          labelClassName={labelClassName}
        />
      )}
      {/* The digits say how long is left; the bar says how far in we are —
          legible in the half-second someone glances up from a laptop. */}
      {progress !== null && (
        <div
          className="bg-muted mt-[0.5em] h-[0.35em] w-[75%] overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={t("hackingWindow")}
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ScheduleBlock({
  schedule,
  visible,
  timezone,
  grow,
}: {
  schedule: PublicScheduleItem[];
  visible: number;
  timezone: string;
  /** Landscape gives the agenda the leftover height; portrait gives it to the sponsors. */
  grow: boolean;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), SCHEDULE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Rows split whatever height the block ends up with, so the agenda fills the
  // screen instead of stacking fixed-height rows above a void — and the scroll
  // offset stays exact arithmetic (rowHeight x index), no per-row measuring.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const em = Number.parseFloat(getComputedStyle(element).fontSize) || 16;
      const fair = element.clientHeight / Math.max(1, visible);
      setRowHeight(Math.min(SCHEDULE_ROW_MAX_EM * em, Math.max(SCHEDULE_ROW_MIN_EM * em, fair)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  const { ordered, startIndex, firstUpcomingIndex } = useMemo(
    () => upcomingWindow(schedule, now, visible),
    [schedule, now, visible],
  );

  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: timezone,
      }),
    [timezone],
  );

  return (
    <section className={cn("flex min-h-0 flex-col gap-[0.75em]", grow && "flex-1")}>
      <h2 className="text-muted-foreground shrink-0 text-[1em] font-medium tracking-[0.18em] uppercase">
        {t("schedule")}
      </h2>
      {ordered.length === 0 ? (
        <p className="text-muted-foreground text-[1.5em]">{t("scheduleEmptyDesc")}</p>
      ) : (
        <div
          ref={viewportRef}
          className={cn("min-h-0 overflow-hidden", grow && "flex-1")}
          style={grow ? undefined : { height: `${visible * SCHEDULE_ROW_MAX_EM}em` }}
        >
          {/* Scrolls itself to whatever hasn't finished yet — nobody can
              scroll a TV, and "what's next" is the only reason to look. */}
          <ol
            className="transition-transform duration-700 ease-in-out"
            style={{ transform: `translateY(-${startIndex * rowHeight}px)` }}
          >
            {ordered.map((item, index) => {
              const done = firstUpcomingIndex === -1 || index < firstUpcomingIndex;
              const isNext = index === firstUpcomingIndex;
              return (
                <li
                  key={item.id}
                  style={{ height: rowHeight || `${SCHEDULE_ROW_MIN_EM}em` }}
                  className={cn(
                    "flex items-center gap-[1em] rounded-[0.4em] border-b px-[0.6em] transition-opacity duration-700",
                    done && "opacity-30",
                    // What's happening next is the one row anyone is looking
                    // for: it gets the accent, everything else stays quiet.
                    isNext && "border-primary/30 bg-primary/5 border-l-[0.25em] border-l-primary",
                  )}
                >
                  {/* Sized by its own content, never a fixed box: a clipped
                      or scrolling clock is worse than a slightly wider column. */}
                  <time
                    dateTime={item.startsAt}
                    className={cn(
                      "shrink-0 whitespace-nowrap text-[1.25em] tabular-nums",
                      isNext ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {format.format(new Date(item.startsAt))}
                  </time>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-[1.4em]",
                      isNext ? "font-semibold" : "font-medium",
                    )}
                  >
                    <MarqueeText text={item.title} />
                  </span>
                  {item.location && (
                    <span className="text-muted-foreground max-w-[10em] shrink-0 text-[1.1em]">
                      <MarqueeText text={item.location} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function SponsorsBlock({ sponsors, portrait }: { sponsors: PublicSponsor[]; portrait: boolean }) {
  const { t } = useLocale();
  // Hooks before the empty-list bail-out: sponsors arrive from a fetch, so
  // this component legitimately renders empty first and populated after.
  const { ref, width, height } = useElementSize<HTMLUListElement>();
  const columns = bestSponsorColumns({
    count: sponsors.length,
    width,
    height,
    gap: SPONSOR_GAP_PX,
    maxColumns: portrait ? 5 : 3,
  });
  if (sponsors.length === 0) return null;
  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col gap-[0.75em]",
        portrait ? "w-full flex-1" : "w-[26%] shrink-0 border-l pl-[2em]",
      )}
    >
      <h2 className="text-muted-foreground shrink-0 text-[1em] font-medium tracking-[0.18em] uppercase">
        {t("sponsors")}
      </h2>
      {/* Tiles stay logo-shaped and take the fewest columns that still fit the
          block, so the same six sponsors read as bigger marks on a bigger
          screen instead of the same small ones with more empty space. */}
      <ul
        ref={ref}
        className="grid min-h-0 flex-1 content-center gap-[0.75em]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {sponsors.map((sponsor) => (
          <li
            key={sponsor.enterpriseId}
            className="bg-muted/40 flex aspect-3/2 items-center justify-center overflow-hidden rounded-[0.6em] p-[0.9em]"
          >
            <SponsorMark sponsor={sponsor} className="max-h-full max-w-full object-contain" />
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** One credential line: a fixed-width label box, then the value. The label box
 * never shrinks, so the value can never be printed over it. */
function WifiRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-[1em]">
      <dt className="text-muted-foreground w-[7em] shrink-0 text-[0.95em] font-medium tracking-[0.18em] uppercase">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function WifiBlock({
  venue,
  showPassword,
  showQr,
}: {
  venue: TvVenueConfig | null;
  showPassword: boolean;
  showQr: boolean;
}) {
  const { t } = useLocale();
  const wifi = venue?.wifi;
  if (!wifi) return null;
  return (
    <div className="flex min-w-0 items-center gap-[1.25em]">
      {showQr ? (
        <WifiQr wifi={wifi} size="5em" className="shrink-0 p-[0.45em]" />
      ) : (
        <WifiIcon className="size-[1.75em] shrink-0" aria-hidden="true" />
      )}
      {/* Network above password, values aligned on a fixed label column — the
          value is what someone is copying off the wall. Deliberately rows of
          two boxes rather than grid tracks: an auto/fr track squeezed below
          its content overlaps the label with the value instead of wrapping,
          and a label the value is printed on top of is worse than one that
          runs a little wide. */}
      <dl className="flex min-w-0 flex-col gap-[0.2em]">
        <WifiRow label={t("networkLabel")}>
          <span className="text-[1.5em] font-semibold whitespace-nowrap">{wifi.ssid}</span>
        </WifiRow>
        {showPassword && wifi.password && (
          <WifiRow label={t("password")}>
            <span className="font-mono text-[1.5em] font-semibold whitespace-nowrap">
              {wifi.password}
            </span>
          </WifiRow>
        )}
      </dl>
    </div>
  );
}

export function LiveScreen({
  config,
  event,
  schedule,
  sponsors,
  venue,
}: {
  config: LiveScreenConfig;
  event: PublicEvent;
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  venue: TvVenueConfig | null;
}) {
  const showWifi = config.wifi.show && Boolean(venue?.wifi);
  return (
    <TvScreen>
      {({ portrait }) => (
        <>
          <TvHeader eventName={event.name} />
          <div
            className={cn(
              "flex min-h-0 flex-1 gap-[2em] p-[2.5em]",
              portrait ? "flex-col" : "flex-row",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-[2.75em]">
              {config.timer.show && (
                <Countdown
                  config={config}
                  event={event}
                  showProgress={
                    config.timer.target === "auto" || config.timer.target === "hackingEndsAt"
                  }
                />
              )}
              {config.schedule.show && (
                <ScheduleBlock
                  schedule={schedule}
                  visible={config.schedule.upcoming}
                  timezone={event.timezone}
                  grow={!portrait || !config.sponsors.show}
                />
              )}
            </div>
            {config.sponsors.show && <SponsorsBlock sponsors={sponsors} portrait={portrait} />}
          </div>
          {showWifi && (
            <footer className="shrink-0 border-t px-[2.5em] py-[1em]">
              <WifiBlock
                venue={venue}
                showPassword={config.wifi.showPassword}
                showQr={config.wifi.showQr}
              />
            </footer>
          )}
        </>
      )}
    </TvScreen>
  );
}
