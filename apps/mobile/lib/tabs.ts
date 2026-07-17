import { CAPABILITIES } from "@hackos/shared/capabilities";

export type TabKey =
  | "schedule"
  | "queue"
  | "wallet"
  | "notifications"
  | "account"
  | "scan"
  | "activities";

const PARTICIPANT_PRIMARY_TAB_KEYS = ["schedule", "queue", "wallet", "notifications"] as const;

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

export function canScanActivities(capabilities: string[]): boolean {
  return has(capabilities, CAPABILITIES.ACTIVITY_SCAN);
}

/**
 * H55: which tabs a signed-in user sees, driven entirely by their effective
 * capabilities (never by `role`) — mirrors the server-side `hasCapability`
 * check in apps/api/src/lib/capabilities.ts (the `*` admin wildcard passes
 * every check).
 */
export function visibleTabs(capabilities: string[]): TabKey[] {
  return [...primaryTabs(capabilities), ...overflowTabs(capabilities)];
}

/**
 * Tabs shown directly in the platform tab bar. Only ever four destinations
 * plus, at most, one overflow slot — a native
 * `UITabBarController` silently collapses everything past its fifth item
 * into its own system "More" screen, which bypasses our overflow menu
 * entirely. Operators prioritize their daily tools here and keep the less
 * frequently used personal destinations in the overflow selector.
 */
export function primaryTabs(capabilities: string[]): TabKey[] {
  if (!isOperator(capabilities)) return [...PARTICIPANT_PRIMARY_TAB_KEYS, "account"];

  return [
    "schedule",
    "scan",
    ...(canScanActivities(capabilities) ? (["activities"] as const) : []),
    "notifications",
  ];
}

/** Tabs represented inside the native Others selector rather than the main bar. */
export function overflowTabs(capabilities: string[]): TabKey[] {
  return isOperator(capabilities) ? ["queue", "wallet", "account"] : [];
}

/** True whenever any tab lives outside the primary bar and needs the overflow selector. */
export function shouldUseOverflowMenu(capabilities: string[]): boolean {
  return overflowTabs(capabilities).length > 0;
}
