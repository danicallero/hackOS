/**
 * Multi-edition contract (docs/multi-edition-plan.md). One installation hosts
 * one edition per year; people and catalogues are global, event data belongs
 * to an edition. Clients send the edition they are viewing on every request.
 */

/** Request header carrying the viewed edition; absent means the current edition. */
export const EDITION_HEADER = "x-edition";

/** Same format as the database CHECK on `editions.event_key`. Keys are never renamed. */
export const EDITION_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const EDITION_STATUSES = ["draft", "active", "closed"] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];

/** Business error code for a write into a closed (read-only) edition. */
export const EDITION_CLOSED_CODE = "edition_closed";

export interface EditionSummary {
  eventKey: string;
  name: string;
  status: EditionStatus;
  startsAt: string | null;
  endsAt: string | null;
  /** The edition in event_config: the default when no header is sent. */
  isCurrent: boolean;
}

/** `GET /api/me/editions`. */
export interface MyEditionsResponse {
  /** The current edition key (what clients reset to on login/app open). */
  current: string;
  /** Editions the user can switch to, newest first. */
  editions: EditionSummary[];
}

/** Show the edition selector only when there is something to choose. */
export function shouldShowEditionSelector(editions: readonly EditionSummary[]): boolean {
  return editions.length > 1;
}
