import type { PublicScheduleItem } from "@/lib/logistics";

export interface PublicEvent {
  name: string | null;
  tagline: string | null;
  timezone: string;
  hackingStartsAt: string | null;
  hackingEndsAt: string | null;
  showStartCountdown: boolean;
  judgingStartsAt: string | null;
  judgingEndsAt: string | null;
}

export interface PublicSponsor {
  id: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  website: string | null;
  tier?: string | null;
}

export interface PublicChallenge {
  id: number;
  title: Record<string, string>;
  description: Record<string, string>;
  criteria: Record<string, string>;
  prizes: unknown;
  availableFrom: string | null;
  enterprise: {
    id: number;
    name: string;
    logoUrl: string | null;
    logoNegativeUrl: string | null;
    website: string | null;
  };
}

export interface PublicAnnouncement {
  id: number;
  title: string;
  body: string;
  publishAt: string | null;
  expiresAt: string | null;
}

/** GET /api/public/applications item — an open form applicants can apply to. */
export interface PublicApplicationForm {
  id: number;
  name: string;
  type: string;
  description: string | null;
  close_at: string | null;
}

export type { PublicScheduleItem };

export function displayText(value: Record<string, string> | null | undefined): string {
  if (!value) return "";
  return value.en ?? value.es ?? value.gl ?? Object.values(value)[0] ?? "";
}
