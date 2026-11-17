import type { UserListItem } from "@/lib/types";

/** Filter value for users without an application / without a visible role. */
export const NO_APPLICATION = "none";
export const NO_ROLE = "__none__";

/** Application statuses in workflow order (H10-H15), matching the column labels. */
export const APPLICATION_FILTER_ORDER: readonly string[] = [
  NO_APPLICATION,
  "draft",
  "review",
  "accepted_internal",
  "accepted",
  "confirmed",
  "rejected_internal",
  "rejected",
  "declined",
  "expired",
];

export const FACETS = ["spot", "role", "email"] as const;
export type Facet = (typeof FACETS)[number];
export type FacetSelection = Record<Facet, readonly string[]>;

export function facetValue(user: UserListItem, facet: Facet): string {
  if (facet === "email") return user.emailVerified ? "verified" : "unverified";
  if (facet === "role") return user.visibleRoleName ?? NO_ROLE;
  return user.applicationStatus ?? NO_APPLICATION;
}

function matches(user: UserListItem, selected: FacetSelection, skip?: Facet): boolean {
  return FACETS.every(
    (facet) =>
      facet === skip ||
      selected[facet].length === 0 ||
      selected[facet].includes(facetValue(user, facet)),
  );
}

/** Categories combine with AND, options within one category with OR, so
 * "Role: Hacker" + "Application: Confirmed" narrows instead of widening. */
export function filterUsers(users: readonly UserListItem[], selected: FacetSelection) {
  return users.filter((user) => matches(user, selected));
}

/** Per-option counts against every *other* active category, so each number is
 * what ticking that option would add. */
export function facetCounts(users: readonly UserListItem[], selected: FacetSelection) {
  const counts = Object.fromEntries(FACETS.map((facet) => [facet, new Map()])) as Record<
    Facet,
    Map<string, number>
  >;
  for (const user of users) {
    for (const facet of FACETS) {
      if (!matches(user, selected, facet)) continue;
      const value = facetValue(user, facet);
      counts[facet].set(value, (counts[facet].get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/** Values someone actually has (plus any already selected): roles by name with
 * Unassigned last (H8), statuses in workflow order. */
export function facetOptions(
  users: readonly UserListItem[],
  facet: "role" | "spot",
  selected: readonly string[],
): string[] {
  const present = new Set(selected);
  for (const user of users) present.add(facetValue(user, facet));
  if (facet === "spot") return APPLICATION_FILTER_ORDER.filter((status) => present.has(status));
  return [...present].sort((a, b) => (a === NO_ROLE ? 1 : b === NO_ROLE ? -1 : a.localeCompare(b)));
}
