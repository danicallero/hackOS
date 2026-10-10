/** One collected stand, as `GET /api/me/diary/sponsors` returns it (#935). */
export interface SponsorCollectionEntry {
  id: number;
  starred: boolean;
  note: string | null;
  createdAt: string;
}

/** One collectible company: revealed, with an active stand tag or already collected. */
export interface SponsorCollectionItem {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  description: string | null;
  website: string | null;
  challenges: { id: number; name: string }[];
  /** null until this attendee scans the company's stand. */
  entry: SponsorCollectionEntry | null;
}

export interface SponsorCollection {
  total: number;
  collected: number;
  /** Collected first (most recent), then the rest by name. */
  items: SponsorCollectionItem[];
}

/** 0..1 share of the album collected; an empty album reads as nothing collected. */
export function collectionProgress(collection: Pick<SponsorCollection, "total" | "collected">) {
  if (collection.total <= 0) return 0;
  return Math.min(1, Math.max(0, collection.collected / collection.total));
}

/** Up to two letters for a company without a logo. */
export function companyMonogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0], words[1]].map((word) => Array.from(word)[0])
      : Array.from(name).slice(0, 2);
  return letters.join("").toUpperCase();
}

/**
 * Apply a PATCH response (or a removal, `entry: null`) to one company without
 * reordering the album under the attendee's finger. Counts follow the change.
 */
export function withCompanyEntry(
  collection: SponsorCollection,
  enterpriseId: number,
  entry: SponsorCollectionEntry | null,
): SponsorCollection {
  let collectedDelta = 0;
  const items = collection.items.map((item) => {
    if (item.enterpriseId !== enterpriseId) return item;
    collectedDelta = Number(entry !== null) - Number(item.entry !== null);
    return { ...item, entry };
  });
  return { ...collection, items, collected: collection.collected + collectedDelta };
}
