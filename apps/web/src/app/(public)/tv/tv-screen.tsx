"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "@/components/common/brand";
import { useTvScale } from "@/hooks/use-tv-scale";
import { cn } from "@/lib/utils";
import { MarqueeText } from "./marquee-text";

/**
 * The frame every TV view renders inside (H41: adapt to whatever screen is on
 * the wall). It owns three things no individual view should re-decide:
 *
 *  - the surface is exactly one screen — `h-dvh`, never scrolls, because
 *    nobody can scroll a TV;
 *  - the root font size, from `useTvScale`, so views authored in `em` fill a
 *    1080p panel, a 4K wall and a portrait totem alike;
 *  - whether the layout is portrait, handed to views that stack differently.
 *
 * Views therefore size themselves in `em` (`text-[2em]`, `p-[1.5em]`), not in
 * Tailwind's rem-based steps, which would stay pinned to the browser root and
 * ignore the screen entirely.
 */
export function TvScreen({
  children,
  className,
}: {
  children: React.ReactNode | ((layout: { portrait: boolean }) => React.ReactNode);
  className?: string;
}) {
  const { ref, scale, portrait } = useTvScale();
  return (
    <div ref={ref} className="bg-background text-foreground h-dvh w-dvw overflow-hidden">
      {/* `leading-*` is not cosmetic here: globals.css sets a fixed
          `line-height: 1.25rem` on body, which every `em`-sized TV text would
          otherwise inherit — a 30px paragraph inside a 20px line box, i.e.
          lines printed on top of each other. A unitless leading scales with
          whatever font size each block picks. */}
      <div
        style={{ fontSize: `${scale * 16}px` }}
        className={cn("flex h-full w-full flex-col overflow-hidden leading-[1.35]", className)}
      >
        {typeof children === "function" ? children({ portrait }) : children}
      </div>
    </div>
  );
}

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** Wall clock, shared by every TV header. Ticks on the minute, not the second. */
export function TvClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className={cn("font-mono tabular-nums", className)} dateTime={now.toISOString()}>
      {clockFormatter.format(now)}
    </time>
  );
}

/**
 * Standard header: who we are on the left, what this screen is plus the time
 * on the right. `eventName` replaces the product wordmark when the organiser
 * has named the event — on a venue wall the hackathon's name is the useful one.
 */
export function TvHeader({
  title,
  icon: Icon,
  eventName,
}: {
  title?: string;
  icon?: LucideIcon;
  eventName?: string | null;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-[1.5em] border-b px-[2.5em] py-[1.5em]">
      {eventName ? (
        <span className="min-w-0 flex-1 text-[1.5em] font-semibold tracking-tight">
          <MarqueeText text={eventName} />
        </span>
      ) : (
        <Brand className="text-[1.25em]" />
      )}
      <div className="flex shrink-0 items-center gap-[1em]">
        {title && (
          <div className="flex items-center gap-[0.5em]">
            {Icon && <Icon className="size-[1.5em] shrink-0" aria-hidden="true" />}
            <h1 className="text-[1.75em] font-semibold text-balance">{title}</h1>
          </div>
        )}
        <TvClock className="shrink-0 text-[1.5em] font-semibold" />
      </div>
    </header>
  );
}

/** Body wrapper for the single-purpose modes: one screenful, centred, no scroll. */
export function TvBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden p-[2.5em]", className)}>
      {children}
    </div>
  );
}

export function TvEmpty({ text }: { text: string }) {
  return (
    <div className="text-muted-foreground grid flex-1 place-items-center rounded-[0.75em] border p-[2em] text-center text-[1.75em]">
      {text}
    </div>
  );
}
