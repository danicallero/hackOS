import { EDITION_HEADER, type EditionSummary } from "@hackos/shared/editions";

/**
 * Viewed-edition state (multi-edition plan). In memory only: a cold start,
 * a sign-in and a sign-out all fall back to the current edition (null), so a
 * past selection never survives a launch. `null` means "current edition" and
 * sends no header; only a deliberate switch to another edition sends one.
 */
let viewed: string | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

export function getViewedEdition(): string | null {
  return viewed;
}

/** Bumps whenever the viewed edition is committed, so the tree can remount. */
export function getEditionEpoch(): number {
  return epoch;
}

export function subscribeEdition(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

/** Select an edition without notifying; call `commitEditionChange` once data followed. */
export function selectViewedEdition(eventKey: string | null): void {
  viewed = eventKey;
}

export function commitEditionChange(): void {
  notify();
}

/** Back to the current edition (sign-in, sign-out). */
export function resetViewedEdition(): void {
  if (viewed === null) return;
  viewed = null;
  notify();
}

/** Header for the viewed edition; empty for the current edition. */
export function editionHeaders(): Record<string, string> {
  return viewed ? { [EDITION_HEADER]: viewed } : {};
}

/** The summary of the viewed edition in `editions`, or the current one when none is selected. */
export function viewedEditionSummary(
  editions: readonly EditionSummary[],
  viewedKey: string | null,
): EditionSummary | undefined {
  return viewedKey
    ? editions.find((edition) => edition.eventKey === viewedKey)
    : editions.find((edition) => edition.isCurrent);
}
