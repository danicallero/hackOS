export type OperationsSection = "account" | "queue" | "wallet" | "external";

export type OperationsRoute =
  | "/(tabs)/others/account"
  | "/(tabs)/others/queue"
  | "/(tabs)/others/wallet";

export type OperationsNavigationAction = "noop" | "replace";

/**
 * The native "Others" control behaves like a small overflow tab bar, not a
 * free-form stack launcher.
 *
 * Contract:
 * - tapping the active pseudo-tab is a no-op;
 * - changing pseudo-tabs always replaces the current section instead of
 *   stacking duplicates;
 * - Queue, Wallet, and Account replace one another instead of stacking
 *   duplicate routes.
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
  if (normalized.startsWith("/others/queue")) return "queue";
  if (normalized.startsWith("/others/wallet")) return "wallet";
  if (normalized.startsWith("/others/account")) return "account";
  return "external";
}

export function operationsSectionFromRoute(route: OperationsRoute): OperationsSection {
  if (route === "/(tabs)/others/queue") return "queue";
  if (route === "/(tabs)/others/wallet") return "wallet";
  return "account";
}

function normalizeOperationsPath(pathname: string): string {
  return pathname.replace(/\/\([^/]+\)/g, "");
}
