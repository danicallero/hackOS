import { CAPABILITIES } from "@hackos/shared/capabilities";
import { MENTOR_PROFILE_CAPABILITY } from "@hackos/shared/onboarding";
import { api } from "./api";
import type { Me } from "./types";

/** GET/PUT /api/me/mentor-profile. */
export interface MentorProfile {
  eligible: boolean;
  published: boolean;
  /** The person's help desk knowledge topics, which a scan shows. */
  expertise: { id: number; label: string }[];
}

export const MENTOR_PROFILE_PATH = "/api/me/mentor-profile";

/** The caller's mentor profile, or (user management) another person's. */
const mentorPath = (subjectId?: number) =>
  subjectId === undefined ? MENTOR_PROFILE_PATH : `/api/users/${subjectId}/mentor-profile`;

export const readMentorProfile = (signal?: AbortSignal, subjectId?: number) =>
  api.get<MentorProfile>(mentorPath(subjectId), { signal });

export const saveMentorProfile = (published: boolean, subjectId?: number) =>
  api.put<MentorProfile>(mentorPath(subjectId), { published });

/** The session-side hint; the API's `eligible` stays the authority. */
export function canOfferHelp(me: Pick<Me, "capabilities">): boolean {
  return (
    me.capabilities.includes(MENTOR_PROFILE_CAPABILITY) ||
    me.capabilities.includes(CAPABILITIES.ADMIN_ALL)
  );
}
