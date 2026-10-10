import { ApiError } from "./api";
import type { MessageKey } from "./i18n";

/** #934 public directory card, exactly as `GET /api/me/diary` returns it. */
export interface DiaryPerson {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  locationNote: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

/** Public sponsor card for a scanned stand (#935). */
export interface DiarySponsor {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  description: string | null;
  website: string | null;
  challenges: { id: number; name: string }[];
}

export interface DiaryEntry {
  id: number;
  kind: "person" | "sponsor";
  starred: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** null while the profile is hidden; nothing is cached on the device for it. */
  person: DiaryPerson | null;
  /** null while the sponsor is not revealed. */
  sponsor: DiarySponsor | null;
}

export function diaryCacheKey(userId: number): string {
  return `user:${userId}:diary`;
}

/** The API order: favourites first, then most recently saved. */
export function sortDiaryEntries(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.starred) - Number(a.starred) ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id - a.id,
  );
}

/** Replace or add one entry returned by a mutation, keeping the API order. */
export function upsertDiaryEntry(entries: DiaryEntry[], entry: DiaryEntry): DiaryEntry[] {
  return sortDiaryEntries([...entries.filter((current) => current.id !== entry.id), entry]);
}

export function isDiaryEntryAvailable(entry: DiaryEntry): boolean {
  return entry.kind === "person" ? entry.person !== null : entry.sponsor !== null;
}

/** Up to two initials for a person without a shared photo. */
export function diaryInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
}

const SCAN_ERROR_KEYS: Record<string, MessageKey> = {
  diary_code_unknown: "diaryScanUnknown",
  badge_revoked: "diaryScanRevoked",
  profile_not_shared: "diaryScanNotShared",
  stand_unavailable: "diaryScanStandUnavailable",
  diary_self: "diaryScanSelf",
};

/**
 * Localized feedback for a failed scan. None of these messages carries a name:
 * the API never reveals who a hidden profile belongs to.
 */
export function diaryScanErrorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return "diaryScanError";
  const known = error.code ? SCAN_ERROR_KEYS[error.code] : undefined;
  if (known) return known;
  if (error.status === 403) return "diaryScanPeopleForbidden";
  if (error.status === 429) return "diaryScanRateLimited";
  return "diaryScanError";
}
