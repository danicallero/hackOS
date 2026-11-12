/**
 * Knows which in-app page sits just below the current history entry, so a back
 * link can use real browser history (list search, filters, page and scroll
 * come back intact) only when that entry is the parent it names.
 *
 * Every `pushState`/`replaceState` made while the app runs (Next's router and
 * the unsaved-changes guard included) stamps its entry with a position and
 * remembers its URL. Entries the app did not create (the page that was open
 * before, another site, anything before a refresh) are unknown, so
 * `previousInAppLocation()` is null and callers fall back to a fixed route.
 */
const POSITION_KEY = "__hackosHistoryPosition";

const locations = new Map<number, string>();
let restore: (() => void) | null = null;

function positionOf(state: unknown): number | null {
  const value = (state as Record<string, unknown> | null)?.[POSITION_KEY];
  return typeof value === "number" ? value : null;
}

function stamp(state: unknown, position: number): unknown {
  const base = state && typeof state === "object" ? state : {};
  return { ...base, [POSITION_KEY]: position };
}

function locationOf(url: string | URL | null | undefined): string {
  const target = new URL(String(url ?? window.location.href), window.location.href);
  return `${target.pathname}${target.search}`;
}

/** Idempotent; wraps the history methods once for the lifetime of the window. */
export function installInAppHistory(): void {
  if (restore || typeof window === "undefined") return;
  const { pushState, replaceState } = window.history;
  const current = positionOf(window.history.state);
  if (current === null) {
    replaceState.call(window.history, stamp(window.history.state, 0), "", window.location.href);
    locations.set(0, locationOf(window.location.href));
  } else {
    locations.set(current, locationOf(window.location.href));
  }

  window.history.pushState = function patchedPush(state, unused, url) {
    const position = (positionOf(window.history.state) ?? -1) + 1;
    for (const key of [...locations.keys()]) if (key >= position) locations.delete(key);
    locations.set(position, locationOf(url));
    return pushState.call(window.history, stamp(state, position), unused, url);
  };
  window.history.replaceState = function patchedReplace(state, unused, url) {
    const position = positionOf(window.history.state) ?? 0;
    locations.set(position, locationOf(url));
    return replaceState.call(window.history, stamp(state, position), unused, url);
  };
  restore = () => {
    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    locations.clear();
    restore = null;
  };
}

/** Test hook: puts the native history methods back and forgets every entry. */
export function uninstallInAppHistory(): void {
  restore?.();
}

/** Path and query of the entry before the current one, or null when unknown. */
export function previousInAppLocation(): string | null {
  if (typeof window === "undefined") return null;
  const position = positionOf(window.history.state);
  if (position === null || position < 1) return null;
  return locations.get(position - 1) ?? null;
}
