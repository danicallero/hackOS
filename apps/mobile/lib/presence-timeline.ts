export interface CertaintyWindowLike {
  start: string;
  deadline: string;
  securedUntil: string | null;
}

export interface CertaintyWindowStatusLike extends CertaintyWindowLike {
  status: "secured" | "provisional" | "invalid";
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

/**
 * The still-open window's elapsed time since its last checkpoint — secured
 * once a later exit/activity lands, worth zero if the window just expires.
 */
export function provisionalMinutesTotal(windows: CertaintyWindowStatusLike[]): number {
  return windows.reduce((sum, window) => {
    if (window.securedUntil || window.status !== "provisional") return sum;
    const end = Math.min(Date.now(), Date.parse(window.deadline));
    return sum + Math.max(0, Math.round((end - Date.parse(window.start)) / 60_000));
  }, 0);
}
