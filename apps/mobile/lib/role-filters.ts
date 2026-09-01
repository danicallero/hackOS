import type { ScannerGroup } from "@/lib/scanner-group-filter";
import { SCANNER_GROUP_VALUES } from "@/lib/scanner-group-filter";
import type { ScannerPerson } from "@/lib/scanner-types";

/**
 * Canonical role-filter catalogue (H8): one row per `badge_category` value a
 * screen can let an operator filter people by. `general-scanner-screen.tsx`
 * and `people-directory-screen.tsx` used to each hardcode their own
 * near-copy of this list and had drifted (different value sets, same
 * category with a different label key). This is now the single source of
 * truth both import from.
 */
export type RoleFilterValue = ScannerPerson["role"];

export type RoleFilterLabelKey =
  | "roleAdmin"
  | "roleStaff"
  | "roleSponsor"
  | "roleMentor"
  | "roleJudge"
  | "roleParticipants";

export type RoleFilterIcon =
  | "person"
  | "person.2"
  | "person.crop.circle.badge.checkmark"
  | "checkmark.seal"
  | "briefcase";

export interface RoleFilterOption {
  value: RoleFilterValue;
  labelKey: RoleFilterLabelKey;
  icon: RoleFilterIcon;
}

/** Full 7-category set (`unassigned` has no filter row — nobody filters by it). */
export const ROLE_FILTER_OPTIONS: RoleFilterOption[] = [
  { value: "admin", labelKey: "roleAdmin", icon: "person.crop.circle.badge.checkmark" },
  { value: "staff", labelKey: "roleStaff", icon: "person.crop.circle.badge.checkmark" },
  { value: "sponsor", labelKey: "roleSponsor", icon: "briefcase" },
  { value: "mentor", labelKey: "roleMentor", icon: "person.2" },
  { value: "judge", labelKey: "roleJudge", icon: "checkmark.seal" },
  { value: "participant", labelKey: "roleParticipants", icon: "person" },
];

/** The "no filter, show everyone" sentinel row, shared by both screens' UIs. */
export const ROLE_FILTER_ALL: { labelKey: "roleAll"; icon: "person.2" } = {
  labelKey: "roleAll",
  icon: "person.2",
};

/**
 * Subset of `ROLE_FILTER_OPTIONS` for the general scanner's group filter,
 * which filters on `ScannerGroup` (see scanner-group-filter.ts) — a coarser
 * operational grouping, not every role value:
 *  - `staff` already covers admins on the ground (`matchesScannerGroup`
 *    folds admin into staff), so admin never gets its own scanner row.
 *  - Judges don't badge-scan at the door or at activities the way the other
 *    groups do, so the door scanner has no reason to offer them as a filter.
 * `people-directory-screen.tsx` filters on the raw role value and needs
 * every category, admin and judge included — see `ROLE_FILTER_OPTIONS`.
 */
export const SCANNER_GROUP_FILTER_OPTIONS: Array<RoleFilterOption & { value: ScannerGroup }> =
  ROLE_FILTER_OPTIONS.filter((option): option is RoleFilterOption & { value: ScannerGroup } =>
    (SCANNER_GROUP_VALUES as readonly string[]).includes(option.value),
  );
