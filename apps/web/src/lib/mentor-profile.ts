import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MENTOR_PROFILE_CAPABILITY } from "@hackos/shared/onboarding";
import { api } from "./api";
import type { Me } from "./types";

/** GET/PUT /api/me/mentor-profile. */
export interface MentorProfile {
  eligible: boolean;
  published: boolean;
  /** The shared expertise catalogue, read through /api/form-libraries/:id. */
  libraryId: string | null;
  expertise: { id: number; label: string }[];
}

export const MENTOR_PROFILE_PATH = "/api/me/mentor-profile";

export const readMentorProfile = (signal?: AbortSignal) =>
  api.get<MentorProfile>(MENTOR_PROFILE_PATH, { signal });

export const saveMentorProfile = (published: boolean, expertiseIds: number[]) =>
  api.put<MentorProfile>(MENTOR_PROFILE_PATH, { published, expertiseIds });

/** The session-side hint; the API's `eligible` stays the authority. */
export function canOfferHelp(me: Pick<Me, "capabilities">): boolean {
  return (
    me.capabilities.includes(MENTOR_PROFILE_CAPABILITY) ||
    me.capabilities.includes(CAPABILITIES.ADMIN_ALL)
  );
}
