export type OperationsSection = "account" | "scanner" | "activities" | "external";

export type OperationsRoute =
  | "/(tabs)/others/account"
  | "/(tabs)/others/scan"
  | "/(tabs)/others/activities";

export type OperationsNavigationAction = "noop" | "replace";

/**
 * The native "Others" control behaves like a small tab bar, not a free-form
 * stack launcher.
 *
 * Contract:
 * - tapping the active pseudo-tab is a no-op;
 * - changing pseudo-tabs always replaces the current section instead of
 *   stacking duplicates;
 * - Account remains reachable from every section; switching to it replaces
 *   the current pseudo-tab instead of stacking a duplicate route.
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
  // (for example `/others/scan`) or preserved in tests / internal flow
  // (`/(tabs)/others/scan`). Normalize both shapes before matching.
  const normalized = normalizeOperationsPath(pathname);
  if (normalized.startsWith("/others/scan")) return "scanner";
  if (normalized.startsWith("/others/activities")) return "activities";
  if (normalized.startsWith("/others/account")) return "account";
  return "external";
}

export function operationsSectionFromRoute(route: OperationsRoute): OperationsSection {
  if (route === "/(tabs)/others/scan") return "scanner";
  if (route === "/(tabs)/others/activities") return "activities";
  return "account";
}

function normalizeOperationsPath(pathname: string): string {
  return pathname.replace(/\/\([^/]+\)/g, "");
}
