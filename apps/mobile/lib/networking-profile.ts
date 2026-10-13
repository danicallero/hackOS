import { apiFetch } from "./api";
import type { DirectoryEntry } from "./directory";
import { createIdempotencyKey } from "./idempotency-key";

/**
 * The public profile other attendees read after scanning the owner's badge
 * (#934, #935), as GET/PUT /api/me/public-profile. Links and the CV file are
 * edited on web; this screen leaves them as stored (the API keeps omitted
 * fields) and only switches whether an existing CV is shared.
 */
export interface NetworkingProfile {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  headline: string | null;
  locationNote: string | null;
  bio: string | null;
  shareCv: boolean;
  /** The CV on file, from the application or an upload; null when there is none. */
  cv: { filename: string; source: "application" | "upload" } | null;
  /** Stamped the first time the person shares; null means never created. */
  consentedAt: string | null;
  /** The card exactly as people who scan the owner see it. */
  preview: DirectoryEntry;
}

/** The owner's own CV route, which `preview.cvUrl` points at while it is shared. */
export const OWN_CV_PATH = "/api/me/public-profile/cv";

export interface NetworkingDraft {
  directoryVisible: boolean;
  showSurname: boolean;
  showPhoto: boolean;
  showProject: boolean;
  headline: string;
  locationNote: string;
  bio: string;
  /** Null when no CV exists: nothing to share, so it is never sent. */
  shareCv: boolean | null;
}

export const HEADLINE_MAX = 80;
export const LOCATION_MAX = 60;
export const BIO_MAX = 500;

export const NETWORKING_PROFILE_PATH = "/networking-profile";

export function fetchNetworkingProfile(): Promise<NetworkingProfile> {
  return apiFetch<NetworkingProfile>("/api/me/public-profile");
}

/** Nobody has shared a profile yet, so the confirmation flow invites them to. */
export function needsNetworkingInvite(profile: NetworkingProfile | null): boolean {
  return profile !== null && profile.consentedAt === null;
}

export function draftFromProfile(profile: NetworkingProfile): NetworkingDraft {
  return {
    directoryVisible: profile.directoryVisible,
    showSurname: profile.showSurname,
    showPhoto: profile.showPhoto,
    showProject: profile.showProject,
    headline: profile.headline ?? "",
    locationNote: profile.locationNote ?? "",
    bio: profile.bio ?? "",
    shareCv: profile.cv ? profile.shareCv : null,
  };
}

export function sameDraft(a: NetworkingDraft, b: NetworkingDraft): boolean {
  return (
    a.directoryVisible === b.directoryVisible &&
    a.showSurname === b.showSurname &&
    a.showPhoto === b.showPhoto &&
    a.showProject === b.showProject &&
    a.headline.trim() === b.headline.trim() &&
    a.locationNote.trim() === b.locationNote.trim() &&
    a.bio.trim() === b.bio.trim() &&
    a.shareCv === b.shareCv
  );
}

export function saveNetworkingProfile(
  draft: NetworkingDraft,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<NetworkingProfile> {
  return apiFetch<NetworkingProfile>("/api/me/public-profile", {
    method: "PUT",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      directoryVisible: draft.directoryVisible,
      showSurname: draft.showSurname,
      showPhoto: draft.showPhoto,
      showProject: draft.showProject,
      headline: draft.headline.trim() || null,
      locationNote: draft.locationNote.trim() || null,
      bio: draft.bio.trim() || null,
      ...(draft.shareCv === null ? {} : { shareCv: draft.shareCv }),
    }),
  });
}
