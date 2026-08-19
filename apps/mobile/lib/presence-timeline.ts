export interface CertaintyWindowLike {
  start: string;
  deadline: string;
  securedUntil: string | null;
}

export function durationMinutes(start: string, end: string): number {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) ? Math.max(0, Math.round(duration / 60_000)) : 0;
}

export function securedWindowFraction(window: CertaintyWindowLike): number {
  if (!window.securedUntil) return 0;
  const total = Date.parse(window.deadline) - Date.parse(window.start);
  const secured = Date.parse(window.securedUntil) - Date.parse(window.start);
  if (!Number.isFinite(total) || !Number.isFinite(secured) || total <= 0) return 0;
  return Math.min(1, Math.max(0, secured / total));
}

/** Time already secured by a later checkpoint, summed across every window. */
export function guaranteedMinutesTotal(windows: CertaintyWindowLike[]): number {
  return windows.reduce(
    (sum, window) =>
      sum + (window.securedUntil ? durationMinutes(window.start, window.securedUntil) : 0),
    0,
  );
}

export interface CertaintyWindowFull extends CertaintyWindowLike {
  status: "secured" | "provisional" | "invalid";
  openedBy: "in" | "activity";
  conflict: boolean;
}

export interface PresenceDivergence {
  /** Overrides the door-only quick-register suggestion for this profile visit. */
  primaryOverride: "in" | "out" | null;
  /** A backfill/fix action to offer alongside the (possibly overridden) primary one. */
  secondary: { kind: "in" | "out"; reason: "activity-open" | "invalid-window"; at: string } | null;
}

/**
 * The door-only quick register (H24) only ever sees `time_logs`, never
 * activity/meal check-ins — so it can suggest "log an entry" for someone
 * who's demonstrably already inside (an activity opened a certainty window
 * with no door `in` behind it), or stay silent about a past session that
 * timed out uncredited because its exit was never scanned. Surface both so
 * staff can fix them via the unrestricted signal-editor flow instead of the
 * gated scan endpoint, which would reject either case outright.
 */
export function detectPresenceDivergence(
  windows: CertaintyWindowFull[],
  doorDirection: "in" | "out",
): PresenceDivergence {
  // Only relevant when the door register is about to suggest "log an entry"
  // — i.e. door ground truth currently shows nobody's inside.
  if (doorDirection !== "in") return { primaryOverride: null, secondary: null };

  const latest = windows.at(-1) ?? null;
  if (!latest) return { primaryOverride: null, secondary: null };

  if (latest.status === "provisional" && latest.openedBy === "activity") {
    return {
      primaryOverride: "out",
      secondary: { kind: "in", reason: "activity-open", at: latest.start },
    };
  }

  // The in→in conflict has its own dedicated banner/fix flow — only offer
  // this shortcut for a plain forgotten-exit timeout. A conflict always sits
  // on the window *before* the one it invalidates (the second `in` opens a
  // fresh window of its own), so an unresolved conflict anywhere in the
  // history — not just on `latest` — must still suppress this shortcut.
  if (latest.status === "invalid" && !windows.some((window) => window.conflict)) {
    return {
      primaryOverride: null,
      secondary: { kind: "out", reason: "invalid-window", at: latest.deadline },
    };
  }

  return { primaryOverride: null, secondary: null };
}
