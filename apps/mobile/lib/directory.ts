import { getCurrentSessionCookie } from "./api";
import type { DiaryEntry } from "./diary";
import { API_URL } from "./env";
import type { MessageKey } from "./i18n";

export type SocialKind = "linkedin" | "github" | "x" | "instagram" | "website" | "other";

/** One opted-in person, exactly as `GET /api/directory/:userId` returns it (#934, #935). */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  bio: string | null;
  locationNote: string | null;
  socials: { kind: SocialKind; url: string }[];
  cvUrl: string | null;
  projects: { kind: "project"; id: number; name: string }[];
  challenges: { id: number; name: string }[];
}

/** Absolute URL of an authenticated, root-relative API asset route. */
export function apiAssetUrl(path: string): string {
  return `${API_URL.replace(/\/+$/, "")}${path}`;
}

const PHOTO_CACHE_LIMIT = 60;
const photoCache = new Map<string, Promise<string>>();

/** A short, stable tag for a session, so cache keys never carry the cookie itself. */
function sessionTag(cookie: string): string {
  let hash = 5381;
  for (let index = 0; index < cookie.length; index += 1) {
    hash = ((hash << 5) + hash + cookie.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * An `expo-image` source for an API photo (#934). The route is private, so the
 * request carries the session cookie (expo-image sends it on Android too,
 * unlike React Native's `Image`). The cache key includes the session: another
 * account on this device re-checks access. Callers keep `cachePolicy="memory"`
 * so a photo is never written to disk and one hidden later is gone after the
 * next launch; the `?v=` in the route changes with every upload. Sponsor logos
 * are absolute public URLs and load directly.
 */
export function apiImageSource(path: string): {
  uri: string;
  headers?: Record<string, string>;
  cacheKey?: string;
} {
  if (!path.startsWith("/")) return { uri: path };
  const url = apiAssetUrl(path);
  const cookie = getCurrentSessionCookie();
  return { uri: url, headers: { Cookie: cookie }, cacheKey: `${sessionTag(cookie)}:${url}` };
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the photo"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The photo's bytes as a data URI, for Skia, which decodes them itself
 * (`connection-celebration-skia.tsx`). Views use `apiImageSource` instead.
 * Kept in memory only, like the views' cache.
 */
export function loadApiImage(path: string): Promise<string> {
  if (!path.startsWith("/")) return Promise.resolve(path);
  const url = apiAssetUrl(path);
  const cookie = getCurrentSessionCookie();
  // Keyed by session too: another account on this device re-checks access.
  const key = `${cookie}\n${url}`;
  const cached = photoCache.get(key);
  if (cached) return cached;
  const request = fetch(url, { headers: { Cookie: cookie } })
    .then((response) => {
      if (!response.ok) throw new Error(`Photo request failed (${response.status})`);
      return response.blob();
    })
    .then(blobToDataUri);
  request.catch(() => photoCache.delete(key));
  photoCache.set(key, request);
  if (photoCache.size > PHOTO_CACHE_LIMIT) {
    const oldest = photoCache.keys().next().value;
    if (oldest) photoCache.delete(oldest);
  }
  return request;
}

/** Lowercased and accent-free, so "José" matches "jose" (as the API search does). */
export function foldSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every visible text of a diary card plus the owner's own note. Cards never
 * carry an email address (#934), so contact details cannot be searched.
 */
function diarySearchText(entry: DiaryEntry): string {
  const person = entry.person;
  const sponsor = entry.sponsor;
  return foldSearchText(
    [
      person?.displayName,
      person?.headline,
      person?.locationNote,
      ...(person?.projects ?? []).map((project) => project.name),
      ...(person?.challenges ?? []).map((challenge) => challenge.name),
      sponsor?.name,
      sponsor?.description,
      ...(sponsor?.challenges ?? []).map((challenge) => challenge.name),
      entry.note,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function filterDiaryEntries(
  entries: DiaryEntry[],
  { query, favouritesOnly }: { query: string; favouritesOnly: boolean },
): DiaryEntry[] {
  const needle = foldSearchText(query);
  return entries.filter(
    (entry) =>
      (!favouritesOnly || entry.starred) && (!needle || diarySearchText(entry).includes(needle)),
  );
}

const SOCIAL_NAMES: Partial<Record<SocialKind, string>> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  x: "X",
  instagram: "Instagram",
};

/** Brand names stay untranslated; a generic link shows its host. */
export function socialLabel(
  link: { kind: SocialKind; url: string },
  t: (key: MessageKey) => string,
): string {
  const brand = SOCIAL_NAMES[link.kind];
  if (brand) return brand;
  if (link.kind === "website") return t("directoryWebsite");
  // The row shows the full link below, so the label is just the site.
  return displayUrl(link.url).split("/")[0] ?? link.url;
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** A file-system-safe name for the downloaded CV. */
export function cvFileName(displayName: string): string {
  const base = foldSearchText(displayName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base ? `${base}-cv.pdf` : "cv.pdf";
}
