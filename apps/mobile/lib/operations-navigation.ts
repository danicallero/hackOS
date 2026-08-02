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

export function operationsSectionFromPathname(pathname: string): OperationsSection {
  // Expo Router may hand us a pathname with route groups stripped
  // (for example `/others/queue`) or preserved in tests / internal flow
  // (`/(tabs)/others/queue`). Normalize both shapes before matching.
  const normalized = normalizeOperationsPath(pathname);
  for (const section of OVERFLOW_TAB_KEYS) {
    const sectionPath = normalizeOperationsPath(OVERFLOW_TAB_ROUTE[section]);
    if (normalized === sectionPath || normalized.startsWith(`${sectionPath}/`)) return section;
  }
  return "external";
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
