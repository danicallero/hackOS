/**
 * Constants and name helpers shared across the user-profile route's files.
 */

import { formatEventDate } from "@/lib/datetime";
import type { Language, UserDetail } from "@/lib/types";

export { roleDisplayName } from "@hackos/shared/display-labels";

export function fullName(u: Pick<UserDetail, "name" | "surname" | "email">): string {
  return [u.name, u.surname].filter(Boolean).join(" ").trim() || u.email;
}

/** Shared clock format for every timestamp on this profile (logs, presence, activity). */
export function formatUserDate(value: string | Date, language: Language): string {
  return formatEventDate(value, language, "dayMonthTime");
}
