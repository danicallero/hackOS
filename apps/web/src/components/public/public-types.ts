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

/** GET /api/public/sponsors item. Keyed by `enterpriseId` — the feed has no `id`. */
export interface PublicSponsor {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  website: string | null;
  priority?: number;
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
  translations?: Partial<Record<"es" | "gl" | "en", { title: string; body: string }>>;
  publishAt: string | null;
  expiresAt: string | null;
  /** Optional while older API deployments are still serving the legacy feed. */
  screenPlacement?: "none" | "fullscreen" | "embedded";
}

/** GET /api/public/applications item — an open form applicants can apply to. */
export interface PublicApplicationForm {
  id: number;
  name: string;
  /** H8: name of the form's highest-position granted role, or null
   *  if it grants none — replaces the retired static `type` field. */
  granted_role_name: string | null;
  description: string | null;
  close_at: string | null;
}

export type { PublicScheduleItem };

export function displayText(
  value: Record<string, string> | null | undefined,
  language = "es",
): string {
  if (!value) return "";
  return value[language] ?? value.es ?? value.gl ?? value.en ?? Object.values(value)[0] ?? "";
}
