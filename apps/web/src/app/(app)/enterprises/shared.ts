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
  description: string | null;
  tier_id: number | null;
  display_priority: number | null;
  visibility: Visibility;
  available_from: string | null;
  director_id: number | null;
  created_at: string;
}

/** Presign response from POST /api/enterprises/:id/logo (storage.PresignedUpload). */
export interface PresignedUpload {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
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

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** ISO timestamp → value for an <input type="datetime-local">. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value → ISO string (or null when empty). */
export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
