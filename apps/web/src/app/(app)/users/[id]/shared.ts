/**
 * Constants and name helpers shared across the user-profile route's files.
 */

import { LOCALE_CODES, type Translate } from "@/lib/i18n";
import type { UserDetail } from "@/lib/types";

/** H8: the header pill just shows the user's actual role name (illustrative tone, never used for gating). */
export const ROLE_TONE = "neutral";

export function roleDisplayName(role: UserDetail["visibleRoleName"], t: Translate): string {
  return role ?? t("roleUnassigned");
}

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
export function formatUserDate(value: string | Date, language: "es" | "gl" | "en"): string {
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
