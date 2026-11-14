import { invalidateAllServerState } from "./server-state";

/**
 * The edition this browser is viewing (docs/multi-edition-plan.md). `null` is
 * the current edition: no `X-Edition` header is sent. The choice is mirrored
 * in a browser-session cookie so server-rendered pages (the gallery) forward
 * the same edition; it never outlives the browser session, and every sign-in
 * and sign-out starts again in the latest active edition.
 */
export const VIEWED_EDITION_COOKIE = "hackos-edition";

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${VIEWED_EDITION_COOKIE}=`));
  const value = match ? decodeURIComponent(match.slice(VIEWED_EDITION_COOKIE.length + 1)) : "";
  return value === "" ? null : value;
}

function writeCookie(eventKey: string | null): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: server-rendered gallery pages forward this edition.
  document.cookie =
    eventKey === null
      ? `${VIEWED_EDITION_COOKIE}=; path=/; max-age=0; samesite=lax`
      : `${VIEWED_EDITION_COOKIE}=${encodeURIComponent(eventKey)}; path=/; samesite=lax`;
}

let viewed: string | null = readCookie();
const listeners = new Set<() => void>();

export function getViewedEdition(): string | null {
  return viewed;
}

export function subscribeViewedEdition(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Switch edition. Everything read so far belongs to the previous one, so
 * cached reads are dropped and subscribers (session facts) refetch.
 */
export function setViewedEdition(eventKey: string | null): void {
  if (viewed === eventKey) return;
  viewed = eventKey;
  writeCookie(eventKey);
  invalidateAllServerState();
  for (const listener of listeners) listener();
}

/** Back to the current edition (sign-in/sign-out). Identity changes already drop caches. */
export function resetViewedEdition(): void {
  viewed = null;
  writeCookie(null);
}
