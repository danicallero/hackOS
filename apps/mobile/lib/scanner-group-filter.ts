import * as SecureStore from "expo-secure-store";
import type { RoleFilterIcon } from "@/lib/role-filters";
import type { ScannerPerson } from "@/lib/scanner-types";

/**
 * The scanner stats/people filter groups shown to the operator. "staff"
 * includes admins — they're the same operational group on the ground even
 * though they may hold different role names (or none at all).
 *
 * H8: `badge_category` is retired, and with it went the fixed "admin"/
 * "staff" role-name spelling — role names are now free text an admin could
 * rename to anything (the default seed doesn't even use those words; real
 * admin/staff roles are named things like "Event Director" or "Day Staff").
 * So "staff" can no longer be identified by matching a role name string —
 * it now matches the real underlying signal the server already used for
 * accreditation-eligibility purposes (stats.ts's `is_operational`):
 * `hasCapabilities` (scanner-sync.ts). `sponsor`/`mentor`/`participant` stay
 * real, reliably-named seeded roles (Sponsor is auto-granted by
 * role_grant_rules; Mentor/Participant are the two attendee roles
 * identity/role.ts's ATTENDEE_ROLE_NAMES names explicitly), so those are
 * still matched by role name (case-insensitively, since names are editable
 * free text). Enterprise judges are intentionally excluded from every group
 * here — door scanners don't badge-scan them.
 */
export type ScannerGroup = "participant" | "mentor" | "staff" | "sponsor";

const STORAGE_KEY = "scanner-group-filter";

function normalizedRole(role: ScannerPerson["role"]): string {
  return role?.toLocaleLowerCase() ?? "";
}

export function matchesScannerGroup(
  person: Pick<ScannerPerson, "role" | "hasCapabilities">,
  groups: ScannerGroup[],
): boolean {
  // An empty selection means "All" — no filtering.
  if (groups.length === 0) return true;
  const normalized = normalizedRole(person.role);
  return groups.some((group) =>
    group === "staff" ? person.hasCapabilities : normalized === group,
  );
}

/**
 * "Confirmed" for the stats tile means "eligible to be accredited", not the
 * raw `confirmed` application flag: staff/admin (capability holders) and
 * sponsors are always eligible (they never file an application, so
 * `confirmed` stays false for them), while participants and mentors are
 * gated by their application's confirmed status. Mirrors stats.ts's
 * scannerRoleStats `is_operational` (minus enterprise judges, who aren't
 * scanned at doors).
 */
export function isAccreditationEligible(
  person: Pick<ScannerPerson, "role" | "confirmed" | "hasCapabilities">,
): boolean {
  if (person.hasCapabilities || normalizedRole(person.role) === "sponsor") return true;
  return person.confirmed;
}

export async function loadScannerGroupFilter(): Promise<ScannerGroup[]> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ScannerGroup =>
      SCANNER_GROUP_VALUES.includes(value as ScannerGroup),
    );
  } catch {
    return [];
  }
}

export async function saveScannerGroupFilter(groups: ScannerGroup[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(groups));
}

export const SCANNER_GROUP_VALUES: ScannerGroup[] = ["participant", "mentor", "staff", "sponsor"];

/**
 * Fixed 4-row filter catalogue for the scanner's own operational grouping —
 * unlike `lib/role-filters.ts`'s roster-derived list (which covers every
 * role name that can appear on `people-directory-screen.tsx`), this stays a
 * small compile-time set because it's not "every role", it's the four
 * door-scanning-relevant operational groups (see `ScannerGroup` above).
 */
export const SCANNER_GROUP_OPTIONS: Array<{
  value: ScannerGroup;
  labelKey: "roleParticipants" | "roleMentor" | "roleStaff" | "roleSponsor";
  icon: RoleFilterIcon;
}> = [
  { value: "participant", labelKey: "roleParticipants", icon: "person" },
  { value: "mentor", labelKey: "roleMentor", icon: "person.2" },
  { value: "staff", labelKey: "roleStaff", icon: "person.crop.circle.badge.checkmark" },
  { value: "sponsor", labelKey: "roleSponsor", icon: "briefcase" },
];
