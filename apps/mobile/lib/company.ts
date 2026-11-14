import { apiFetch } from "./api";
import type { ScheduleItem } from "./schedule";

/** `GET /api/enterprises/:id/profile` (H44; challenges only once revealed, H45; activities by H59 visibility). */
export interface CompanyProfile {
  id: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  website: string | null;
  description: string | null;
  representatives: {
    userId: number;
    name: string;
    firstName: string;
    surname: string | null;
    avatarUrl: string | null;
  }[];
  challenges: { id: number; title: string; summary: string | null }[];
  activities: ScheduleItem[];
}

/** A speaker on a schedule item (H48 extension). */
export interface ScheduleSpeaker {
  userId: number;
  name: string;
  firstName: string;
  surname: string | null;
  avatarUrl: string | null;
  /** Every company the speaker belongs to, oldest membership first. */
  enterprises: { id: number; name: string }[];
}

/** A company linked to a schedule item or shown on a person's profile. */
export interface CompanyRef {
  id: number;
  name: string;
  logoUrl: string | null;
}

export async function fetchCompanyProfile(id: number): Promise<CompanyProfile> {
  const profile = await apiFetch<CompanyProfile>(`/api/enterprises/${id}/profile`);
  return {
    ...profile,
    representatives: profile.representatives ?? [],
    challenges: profile.challenges ?? [],
    activities: profile.activities ?? [],
  };
}
