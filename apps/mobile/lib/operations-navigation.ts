import { OVERFLOW_TAB_KEYS, OVERFLOW_TAB_ROUTE, type OverflowTabKey } from "./overflow-tabs";

export type OperationsSection = OverflowTabKey | "external";

export type OperationsRoute = (typeof OVERFLOW_TAB_ROUTE)[OverflowTabKey];

export type OperationsNavigationAction = "noop" | "replace";

/**
 * The native "Others" control behaves like a small overflow tab bar, not a
 * free-form stack launcher.
 *
 * Contract:
 * - tapping the active pseudo-tab is a no-op;
 * - changing pseudo-tabs always replaces the current section instead of
 *   stacking duplicates;
 * - every destination declared in OVERFLOW_TAB_ROUTE participates without a
 *   second hand-maintained route list.
 */
export function resolveOperationsNavigationAction(
  currentPathname: string,
  targetRoute: OperationsRoute,
): OperationsNavigationAction {
  const currentSection = operationsSectionFromPathname(currentPathname);
  const targetSection = operationsSectionFromRoute(targetRoute);

  if (currentSection === targetSection) return "noop";
  return "replace";
}

/**
 * Deep pages that belong to a pseudo-tab other than the one whose route they
 * share a prefix with: a queue-operations entry opens `others/team/[entryId]`.
 */
const OVERFLOW_SECTION_SUBTREES: Record<string, OverflowTabKey> = {
  "/others/team": "operations",
};

const OTHERS_ROOT = "/others";

export function operationsSectionFromPathname(pathname: string): OperationsSection {
  // Expo Router may hand us a pathname with route groups stripped
  // (for example `/others/queue`) or preserved in tests / internal flow
  // (`/(tabs)/others/queue`). Normalize both shapes before matching.
  const normalized = normalizeOperationsPath(pathname);
  for (const section of OVERFLOW_TAB_KEYS) {
    if (isWithin(normalized, normalizeOperationsPath(OVERFLOW_TAB_ROUTE[section]))) return section;
  }
  for (const [subtree, section] of Object.entries(OVERFLOW_SECTION_SUBTREES)) {
    if (isWithin(normalized, subtree)) return section;
  }
  // Every other page in the Others stack (Wallet, notification settings,
  // reminders, announcements, Storage, Statistics, Company tags, Legal,
  // Delete account, scan log, sync queue, person details...) is pushed from
  // Account, so the user is still inside it.
  if (isWithin(normalized, OTHERS_ROOT)) return "account";
  return "external";
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function operationsSectionFromRoute(route: OperationsRoute): OverflowTabKey {
  for (const section of OVERFLOW_TAB_KEYS) {
    if (OVERFLOW_TAB_ROUTE[section] === route) return section;
  }

  // OperationsRoute is derived from OVERFLOW_TAB_ROUTE, so reaching this at
  // runtime means an untyped native payload violated the navigation contract.
  throw new Error(`Unknown overflow route: ${route}`);
}

function normalizeOperationsPath(pathname: string): string {
  return pathname.replace(/\/\([^/]+\)/g, "");
}
