/**
 * Knows which in-app page sits just below the current history entry, so a back
 * link can use real browser history (list search, filters, page and scroll
 * come back intact) when that entry has a known page title or is the canonical parent.
 *
 * Every `pushState`/`replaceState` made while the app runs (Next's router and
 * the unsaved-changes guard included) stamps its entry with a position and
 * remembers its URL. Entries the app did not create (the page that was open
 * before, another site, anything before a refresh) are unknown, so
 * `previousInAppEntry()` is null and callers fall back to a fixed route.
 */
const POSITION_KEY = "__hackosHistoryPosition";

interface HistoryEntry {
  url: string;
  label: string | null;
}
const locations = new Map<number, HistoryEntry>();
const listeners = new Set<() => void>();
const notify = () => {
  // H44, H63: Next updates history in an insertion effect; notify React after that commit.
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
};

export function subscribeInAppHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
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
    locations.set(0, { url: locationOf(window.location.href), label: null });
  } else {
    locations.set(current, { url: locationOf(window.location.href), label: null });
  }

  window.history.pushState = function patchedPush(state, unused, url) {
    const position = (positionOf(window.history.state) ?? -1) + 1;
    for (const key of [...locations.keys()]) if (key >= position) locations.delete(key);
    const previous = locations.get(position - 1);
    if (previous) {
      previous.label = document.querySelector("main h1")?.textContent?.trim() || previous.label;
    }
    locations.set(position, { url: locationOf(url), label: null });
    const result = pushState.call(window.history, stamp(state, position), unused, url);
    notify();
    return result;
  };
  window.history.replaceState = function patchedReplace(state, unused, url) {
    const position = positionOf(window.history.state) ?? 0;
    const previous = locations.get(position);
    locations.set(position, { url: locationOf(url), label: previous?.label ?? null });
    const result = replaceState.call(window.history, stamp(state, position), unused, url);
    notify();
    return result;
  };
  window.addEventListener("popstate", notify);
  notify();
  restore = () => {
    window.removeEventListener("popstate", notify);
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

/** Previous in-app destination and the visible heading captured when leaving it. */
export function previousInAppEntry(): HistoryEntry | null {
  if (typeof window === "undefined") return null;
  const position = positionOf(window.history.state);
  if (position === null || position < 1) return null;
  return locations.get(position - 1) ?? null;
}
