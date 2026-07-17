import { CAPABILITIES } from "@hackos/shared/capabilities";

export type TabKey = "schedule" | "queue" | "wallet" | "notifications" | "account" | "scan";

/** Always in the primary bar, regardless of capabilities (H55 stable personal area). */
const BASE_PRIMARY_TAB_KEYS = ["schedule", "queue", "wallet", "notifications"] as const;

const STAFF_SCAN_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;

function has(capabilities: string[], capability: string): boolean {
  return capabilities.includes(capability) || capabilities.includes(CAPABILITIES.ADMIN_ALL);
}

export function isOperator(capabilities: string[]): boolean {
  return STAFF_SCAN_CAPABILITIES.some((cap) => has(capabilities, cap));
}

/**
 * H55: which tabs a signed-in user sees, driven entirely by their effective
 * capabilities (never by `role`) — mirrors the server-side `hasCapability`
 * check in apps/api/src/lib/capabilities.ts (the `*` admin wildcard passes
 * every check).
 */
export function visibleTabs(capabilities: string[]): TabKey[] {
  const tabs: TabKey[] = [...BASE_PRIMARY_TAB_KEYS];
  if (isOperator(capabilities)) tabs.push("scan");
  tabs.push("account");
  return tabs;
}

/**
 * Tabs shown directly in the platform tab bar. Only ever the four
 * participant tabs plus, at most, one more slot — a native
 * `UITabBarController` silently collapses everything past its fifth item
 * into its own system "More" screen, which bypasses our overflow menu
 * entirely. Operators keep `account` and `scan` behind the overflow
 * selector precisely to stay under that limit.
 */
export function primaryTabs(capabilities: string[]): TabKey[] {
  const tabs: TabKey[] = [...BASE_PRIMARY_TAB_KEYS];
  if (!isOperator(capabilities)) tabs.push("account");
  return tabs;
}

/** Tabs represented inside the native Others selector rather than the main bar. */
export function overflowTabs(capabilities: string[]): TabKey[] {
  return isOperator(capabilities) ? ["account", "scan"] : [];
}

/** True whenever any tab lives outside the primary bar and needs the overflow selector. */
export function shouldUseOverflowMenu(capabilities: string[]): boolean {
  return overflowTabs(capabilities).length > 0;
}
