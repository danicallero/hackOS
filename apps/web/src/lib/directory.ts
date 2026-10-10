import { API_URL } from "./env";
import type { MessageKey } from "./i18n";

/**
 * People directory types and helpers shared by the directory pages and the
 * public-profile section of My profile (#934, #935, docs/directory.md).
 */

export const SOCIAL_KINDS = ["linkedin", "github", "x", "instagram", "website", "other"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export const SOCIALS_MAX = 6;

export interface SocialLink {
  kind: SocialKind;
  url: string;
}

/** `DirectoryEntry` from the API: everything a directory reader may see. */
export interface DirectoryEntry {
  userId: number;
  displayName: string;
  /** Authenticated API path (see `apiAssetUrl`), never a public bucket URL. */
  photoUrl: string | null;
  headline: string | null;
  bio: string | null;
  locationNote: string | null;
  socials: SocialLink[];
  /** Authenticated API path, only while the person shares their CV. */
  cvUrl: string | null;
  project: { kind: "project" | "workGroup"; id: number; name: string } | null;
  challenges: { id: number; name: string }[];
}

export const SOCIAL_LABEL: Record<SocialKind, MessageKey> = {
  linkedin: "socialLinkedin",
  github: "socialGithub",
  x: "socialX",
  instagram: "socialInstagram",
  website: "socialWebsite",
  other: "socialOther",
};

/**
 * Absolute URL for a path the API returns for a private profile file (photo,
 * CV). The browser sends the session cookie; the API checks access on every
 * request. Absolute URLs pass through unchanged.
 */
export function apiAssetUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
}

/** A link as people read it: host and path, without scheme or trailing slash. */
export function socialLinkText(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}
