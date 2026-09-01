import type { MessageKey } from "@/lib/i18n";
import type { ScannerPerson } from "@/lib/scanner-types";

/**
 * Dynamic role-filter catalogue (H8). `badge_category` (a small fixed enum)
 * has been retired — a person's `role` on the synced roster is now their
 * actual highest-visible role NAME (admin-editable free text), or null when
 * they have none. There is no fixed, compile-time-known set of role values
 * any more, so the filter options are derived at render time from whichever
 * roles are actually present on the currently-synced roster, rather than
 * fetched separately from `GET /api/roles` — the roles catalogue can contain
 * custom role names that nobody on the current roster actually holds, which
 * would offer filter rows that match nobody. Deriving from the roster instead
 * guarantees every option is always a value someone can actually be filtered
 * by. (The scanner's own "staff"/"sponsor" operational grouping, which used
 * to ride on this same role value, now uses the real
 * `hasCapabilities`/`isEnterpriseJudge` fields instead — see
 * scanner-group-filter.ts.)
 */
export type RoleFilterValue = string | null;

export type RoleFilterIcon =
  | "person"
  | "person.2"
  | "person.crop.circle.badge.checkmark"
  | "checkmark.seal"
  | "briefcase";

export interface RoleFilterOption {
  /** Never null — a person with no visible role never gets its own filter row. */
  value: string;
  label: string;
  icon: RoleFilterIcon;
}

/** Cosmetic best-effort icon hint for the well-known default-seeded role names; any other (custom) role name gets a generic icon. */
const KNOWN_ROLE_ICONS: Partial<Record<string, RoleFilterIcon>> = {
  sponsor: "briefcase",
  mentor: "person.2",
  participant: "person",
};

function iconForRole(role: string | null): RoleFilterIcon {
  if (role == null) return "person";
  return KNOWN_ROLE_ICONS[role.toLocaleLowerCase()] ?? "checkmark.seal";
}

/**
 * Display text for a `ScannerPerson.role` value (H8 — badge_category
 * retired): a real role name is shown as-is, untranslated; null (no visible
 * role) falls back to the translated "Unassigned" label.
 */
export function roleDisplayName(role: RoleFilterValue, t: (key: MessageKey) => string): string {
  return role ?? t("roleUnassigned");
}

/** Icon for the "no filter, show everyone" sentinel row, shared by both screens' UIs (label comes from `t("roleAll")`). */
export const ROLE_FILTER_ALL_ICON: "person.2" = "person.2";

/**
 * Builds the filter option list from whichever roles are present on the
 * given roster right now — one row per distinct `role` value, alphabetized.
 * A null (unassigned) role never gets its own filter row (nobody
 * deliberately filters for "nobody's set them up yet"), same as before
 * badge_category retirement.
 */
export function roleFilterOptionsFromRoster(
  people: ReadonlyArray<Pick<ScannerPerson, "role">>,
  roleLabel: (role: RoleFilterValue) => string,
): RoleFilterOption[] {
  const seen = new Set<string>();
  const options: RoleFilterOption[] = [];
  for (const person of people) {
    if (person.role == null || seen.has(person.role)) continue;
    seen.add(person.role);
    options.push({
      value: person.role,
      label: roleLabel(person.role),
      icon: iconForRole(person.role),
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
