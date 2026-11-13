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
  representatives: { userId: number; name: string; avatarUrl: string | null }[];
  challenges: { id: number; title: string; summary: string | null }[];
  activities: ScheduleItem[];
}

/** A speaker on a schedule item (H48 extension). */
export interface ScheduleSpeaker {
  userId: number;
  name: string;
  avatarUrl: string | null;
  enterpriseId: number | null;
  enterpriseName: string | null;
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

/** A stable hue from the company name: logos are private-cacheable bitmaps with no pixel access, so the hero tint is derived from the name. */
export function companyHue(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return hash;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/**
 * Hero gradient for a company: the name's tint fading to transparent over the
 * screen background. The tint stays soft (alpha ≤ .55, muted lightness), so
 * the system label colour keeps its contrast in both schemes.
 */
export function heroGradient(name: string, dark: boolean): string {
  const [r, g, b] = hslToRgb(companyHue(name), dark ? 0.5 : 0.65, dark ? 0.4 : 0.6);
  return `linear-gradient(to bottom, rgba(${r},${g},${b},${dark ? 0.6 : 0.5}) 0%, rgba(${r},${g},${b},0) 100%)`;
}
