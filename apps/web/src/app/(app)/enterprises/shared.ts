// Enterprise (sponsor) management — shared types & helpers (H43/H44).
// The API returns enterprise rows in snake_case (apps/api/.../sponsors/service.ts
// COLUMNS) while create/update bodies are camelCase — kept apart deliberately.
// Types are defined locally so we never touch @/lib/types.

import type { Tone } from "@/lib/tones";

export type Visibility = "visible" | "hidden";

/** Row shape returned by GET /api/enterprises and /api/enterprises/:id. */
export interface Enterprise {
  id: number;
  name: string;
  website: string | null;
  logo_url: string | null;
  logo_negative_url: string | null;
  description: string | null;
  priority: number | null;
  visibility: Visibility;
  available_from: string | null;
  director_id: number | null;
  created_at: string;
}

/** Mirror of sponsors/schemas.ts LOGO_CONTENT_TYPES — accepted logo MIME types. */
export const LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
] as const;

export const LOGO_ACCEPT = LOGO_CONTENT_TYPES.join(",");

export function visibilityTone(v: Visibility): Tone {
  return v === "visible" ? "success" : "neutral";
}

/** An enterprise whose scheduled reveal is still in the future. */
export function isScheduled(availableFrom: string | null): boolean {
  if (!availableFrom) return false;
  const at = new Date(availableFrom);
  return !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
}

export { initials } from "@/lib/initials";

export type EnterpriseTab = "profile" | "challenges" | "judges" | "members" | "stand";

/** Removed tabs keep old deep links working (#928, #929). */
export const ENTERPRISE_TAB_ALIASES: Partial<Record<string, EnterpriseTab>> = {
  overview: "profile",
  invitations: "profile",
};

/**
 * Challenges list only what a manager or the enterprise's own rep can load;
 * anyone else would get an empty tab (H43, H44).
 */
export function enterpriseTabs({
  canManage,
  isSponsorRep,
}: {
  canManage: boolean;
  isSponsorRep: boolean;
}): EnterpriseTab[] {
  return [
    "profile",
    ...(canManage || isSponsorRep ? (["challenges"] as const) : []),
    "judges",
    ...(canManage ? (["members", "stand"] as const) : []),
  ];
}
