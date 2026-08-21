import { ACTIVITY_KINDS, type ActivityKind } from "@hackos/shared/activity-kinds";
import type { ScannerActivity } from "@/lib/scanner-types";

/**
 * An activity that already started still counts as "the one happening now"
 * for this long. Beyond it the list stops pointing at a session nobody is
 * scanning into any more and looks ahead to the next one instead — the
 * snapshot carries no end time (see scanner-sync.ts), so this stands in for
 * one.
 */
const STILL_RUNNING_MS = 2 * 60 * 60 * 1000;

/** The kinds present in `items`, ordered as the activity editor orders them. */
export function activityKinds(items: ScannerActivity[]): string[] {
  const present = new Set(items.map((item) => item.category));
  const known = ACTIVITY_KINDS.filter((kind) => present.has(kind));
  // Categories are free text in the DB (`activities.category`), so anything
  // outside the built-in list still needs a way through the filter.
  const extra = [...present].filter((kind) => !ACTIVITY_KINDS.includes(kind as ActivityKind));
  return [...known, ...extra.sort()];
}

export function filterActivities(
  items: ScannerActivity[],
  { query, kind }: { query: string; kind: string | null },
): ScannerActivity[] {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (kind && item.category !== kind) return false;
    if (!needle) return true;
    return item.name.toLocaleLowerCase().includes(needle);
  });
}

/**
 * The activity closest to `now`: the one running right now if there is one,
 * otherwise the next to start. Returns null once everything is far enough in
 * the past that pointing at it would be noise.
 */
export function closestActivity(
  items: ScannerActivity[],
  now: number,
): { id: number; running: boolean } | null {
  let running: { id: number; at: number } | null = null;
  let next: { id: number; at: number } | null = null;
  for (const item of items) {
    const at = item.startsAt ? Date.parse(item.startsAt) : Number.NaN;
    if (Number.isNaN(at)) continue;
    if (at <= now) {
      // Most recently started wins — that's the session still open.
      if (now - at <= STILL_RUNNING_MS && (!running || at > running.at))
        running = { id: item.id, at };
    } else if (!next || at < next.at) {
      next = { id: item.id, at };
    }
  }
  if (running && next) {
    return now - running.at <= next.at - now
      ? { id: running.id, running: true }
      : { id: next.id, running: false };
  }
  if (running) return { id: running.id, running: true };
  return next ? { id: next.id, running: false } : null;
}

/**
 * Whether two loads produced the same list. The activities screen reloads
 * from SQLite on every 15s sync tick; committing a fresh array each time
 * would re-render every row (and bounce the scroll offset under the large
 * title) for data that almost never changes.
 */
export function sameActivities(a: ScannerActivity[], b: ScannerActivity[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      item.id === other.id &&
      item.name === other.name &&
      item.category === other.category &&
      item.requiresScan === other.requiresScan &&
      item.startsAt === other.startsAt
    );
  });
}
