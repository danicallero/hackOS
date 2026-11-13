import { apiFetch } from "./api";
import type { ScheduleItem } from "./schedule";

/** `GET /api/enterprises/:id/profile` (H44; challenges only once revealed, H45; activities by H59 visibility). */
export interface CompanyProfile {
  id: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  /** Representative colour of the logo ("#rrggbb"), server-computed; null falls back to a neutral tint. */
  logoColor: string | null;
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

const NEUTRAL: RGB = [142, 142, 147];

type RGB = [number, number, number];

function parseHex(hex: string | null | undefined): RGB | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Hero tint from the logo's colour (`logoColor`, "#rrggbb"; null falls back to
 * a neutral grey): a gradient fading to transparent over the screen background,
 * plus the foreground (white or black) that reads on the tint at the strongest
 * point of the gradient. Dark mode darkens the tint so it does not glare.
 */
export function heroTint(
  logoColor: string | null | undefined,
  dark: boolean,
): { gradient: string; foreground: "white" | "black" } {
  const base = parseHex(logoColor) ?? NEUTRAL;
  const tint = (dark ? base.map((v) => Math.round(v * 0.6)) : base) as RGB;
  const alpha = dark ? 0.7 : 0.5;
  const ground = dark ? 0 : 255;
  const shown = tint.map((v) => Math.round(v * alpha + ground * (1 - alpha))) as RGB;
  // Contrast against white vs black text: pick the better one.
  const foreground = luminance(shown) > 0.179 ? "black" : "white";
  const [r, g, b] = tint;
  return {
    gradient: `linear-gradient(to bottom, rgba(${r},${g},${b},${alpha}) 0%, rgba(${r},${g},${b},0) 100%)`,
    foreground,
  };
}
