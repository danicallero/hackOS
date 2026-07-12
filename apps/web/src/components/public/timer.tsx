"use client";

import { useEffect, useState } from "react";
import { type Translate, useLocale } from "@/lib/i18n";
import type { PublicEvent } from "./public-types";

function remaining(target: string | null) {
  if (!target) return null;
  return Math.max(0, new Date(target).getTime() - Date.now());
}

export function formatted(ms: number | null) {
  if (ms === null) return "--:--:--";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours, minutes, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

export function EventTimer({ endsAt, className }: { endsAt: string | null; className?: string }) {
  const [left, setLeft] = useState(() => remaining(endsAt));

  useEffect(() => {
    setLeft(remaining(endsAt));
    const interval = window.setInterval(() => setLeft(remaining(endsAt)), 1000);
    return () => window.clearInterval(interval);
  }, [endsAt]);

  return <time className={className}>{formatted(left)}</time>;
}

export type EventPhase =
  | { kind: "hacking-starts-in"; label: string; target: string }
  | { kind: "hacking-frozen"; label: string; ms: number }
  | { kind: "hacking-remaining"; label: string; target: string }
  | { kind: "judging-starts-in"; label: string; target: string }
  | { kind: "judging-remaining"; label: string; target: string }
  | { kind: "none" };

/**
 * Before hacking_starts_at the countdown must not tick: it either sits frozen
 * on the full hacking_ends_at - hacking_starts_at span, or (if the organiser
 * opted in) counts down toward the start instead. Once hacking ends, the same
 * widget hands off to the judging window (queue_settings, H39) if one is set.
 */
export function computeEventPhase(
  event: PublicEvent | null,
  now: number,
  t: Translate,
): EventPhase {
  if (!event) return { kind: "none" };
  const start = event.hackingStartsAt ? new Date(event.hackingStartsAt).getTime() : null;
  const end = event.hackingEndsAt ? new Date(event.hackingEndsAt).getTime() : null;

  if (end === null) return { kind: "none" };

  if (start === null) {
    // No start configured: keep the legacy plain countdown-to-end behaviour.
    return {
      kind: "hacking-remaining",
      label: t("timeRemaining"),
      target: event.hackingEndsAt as string,
    };
  }

  if (now < start) {
    return event.showStartCountdown
      ? {
          kind: "hacking-starts-in",
          label: t("hackingStartsIn"),
          target: event.hackingStartsAt as string,
        }
      : { kind: "hacking-frozen", label: t("hackingWindow"), ms: end - start };
  }

  if (now < end) {
    return {
      kind: "hacking-remaining",
      label: t("timeRemaining"),
      target: event.hackingEndsAt as string,
    };
  }

  const judgingStart = event.judgingStartsAt ? new Date(event.judgingStartsAt).getTime() : null;
  const judgingEnd = event.judgingEndsAt ? new Date(event.judgingEndsAt).getTime() : null;

  if (judgingStart !== null && now < judgingStart) {
    return {
      kind: "judging-starts-in",
      label: t("judgingStartsIn"),
      target: event.judgingStartsAt as string,
    };
  }
  if (judgingEnd !== null && now < judgingEnd) {
    return {
      kind: "judging-remaining",
      label: t("judgingEndsIn"),
      target: event.judgingEndsAt as string,
    };
  }
  return { kind: "none" };
}

/** Ticks every second so callers can decide whether/how to render the current phase. */
export function useEventPhase(event: PublicEvent | null): EventPhase {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return computeEventPhase(event, now, t);
}

export function EventPhaseDisplay({
  phase,
  className,
  labelClassName = "text-muted-foreground text-sm",
}: {
  phase: EventPhase;
  className?: string;
  labelClassName?: string;
}) {
  if (phase.kind === "none") return null;
  return (
    <>
      <p className={labelClassName}>{phase.label}</p>
      {phase.kind === "hacking-frozen" ? (
        <time className={className}>{formatted(phase.ms)}</time>
      ) : (
        <EventTimer endsAt={phase.target} className={className} />
      )}
    </>
  );
}
