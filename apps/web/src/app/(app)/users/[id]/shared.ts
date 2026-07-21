/**
 * Constants and name helpers shared across the user-profile route's files.
 */

import type { Tone } from "@/lib/tones";
import type { DerivedRole, UserDetail } from "@/lib/types";

export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

/** Illustrative role → tone (never used for gating, only for the header pill). */
export const ROLE_TONE: Record<DerivedRole, Tone> = {
  admin: "brand",
  judge: "info",
  sponsor: "warning",
  staff: "success",
  participant: "neutral",
};

export function fullName(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  return [u.name, u.surname].filter(Boolean).join(" ").trim() || u.email;
}

export function initials(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  const a = u.name?.trim()?.[0];
  const b = u.surname?.trim()?.[0];
  if (a || b) return `${a ?? ""}${b ?? ""}`.toUpperCase();
  return u.email.slice(0, 2).toUpperCase();
}

export const TAB_VALUES = [
  "overview",
  "qr",
  "permissions",
  "presence",
  "activity",
  "application",
  "projects",
] as const;

/** Shared clock format for every timestamp on this profile (logs, presence, activity). */
export const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
