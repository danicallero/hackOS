import { CAPABILITIES } from "@hackos/shared/capabilities";

export type TabKey = "schedule" | "queue" | "wallet" | "notifications" | "scan";

const STAFF_SCAN_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;

function has(capabilities: string[], capability: string): boolean {
  return capabilities.includes(capability) || capabilities.includes(CAPABILITIES.ADMIN_ALL);
}

/**
 * H55: which tabs a signed-in user sees, driven entirely by their effective
 * capabilities (never by `role`) — mirrors the server-side `hasCapability`
 * check in apps/api/src/lib/capabilities.ts (the `*` admin wildcard passes
 * every check). Participant tabs are unconditional; `scan` (staff offline
 * scanners, built in a later phase) only appears for accreditation/presence/
 * activity scan capability holders.
 */
export function visibleTabs(capabilities: string[]): TabKey[] {
  const tabs: TabKey[] = ["schedule", "queue", "wallet", "notifications"];
  if (STAFF_SCAN_CAPABILITIES.some((cap) => has(capabilities, cap))) {
    tabs.push("scan");
  }
  return tabs;
}
