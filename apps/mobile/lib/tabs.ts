import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Platform } from "react-native";
import type { OverflowTabKey } from "./overflow-tabs";

export type TabKey = "schedule" | "notifications" | "scan" | "activities" | OverflowTabKey;

const PARTICIPANT_PRIMARY_TAB_KEYS = ["schedule", "queue", "wallet", "notifications"] as const;

const STAFF_SCAN_CAPABILITIES = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
] as const;

export function has(capabilities: string[], capability: string): boolean {
  return capabilities.includes(capability) || capabilities.includes(CAPABILITIES.ADMIN_ALL);
}

export function isOperator(capabilities: string[]): boolean {
  return STAFF_SCAN_CAPABILITIES.some((cap) => has(capabilities, cap));
}

export function canScanActivities(capabilities: string[]): boolean {
  return has(capabilities, CAPABILITIES.ACTIVITY_SCAN);
}

/** Queue controls are a separate work surface from the offline scanners. */
export function canOperateQueues(capabilities: string[]): boolean {
  return (
    has(capabilities, CAPABILITIES.QUEUE_OPERATE) || has(capabilities, CAPABILITIES.QUEUE_ADMIN)
  );
}

/** Queue-only operators get Queue operations in the bar; scanner operators use Others. */
export function queueOperationsInPrimaryBar(capabilities: string[]): boolean {
  return canOperateQueues(capabilities) && !isOperator(capabilities);
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
 * Tabs shown directly in the custom tab bar. The bar reserves a separate
 * Others circle only when the complete set is crowded. Operators prioritize
 * their daily tools here; five destinations fit directly, while larger sets
 * use four direct tabs plus Others.
 */
export function primaryTabs(capabilities: string[]): TabKey[] {
  if (queueOperationsInPrimaryBar(capabilities)) {
    return ["schedule", "operations", "notifications"];
  }
  if (!isOperator(capabilities)) return [...PARTICIPANT_PRIMARY_TAB_KEYS];

  return [
    "schedule",
    "scan",
    ...(canScanActivities(capabilities) ? (["activities"] as const) : []),
    "notifications",
  ];
}

/** Tabs represented inside the Others selector rather than the main bar. */
export function overflowTabs(capabilities: string[]): OverflowTabKey[] {
  if (!isOperator(capabilities) && !canOperateQueues(capabilities)) return ["account"];
  return [
    "queue",
    "wallet",
    "account",
    ...(isOperator(capabilities) && canOperateQueues(capabilities)
      ? (["operations"] as const)
      : []),
  ];
}

/** True only when the complete tab set cannot fit as five direct destinations. */
export function shouldUseOverflowMenu(capabilities: string[]): boolean {
  // Five destinations still fit as ordinary direct tabs. Others is reserved
  // for a genuinely crowded navigation set, where the bar keeps four direct
  // cells and moves the remaining destinations behind the native menu.
  return visibleTabs(capabilities).length > 5;
}

/**
 * True on real iPad hardware, and identically true for this same iPad build
 * running "Designed for iPad" on an Apple Silicon Mac — UIKit reports both
 * as the `.pad` interface idiom. Idiom — unlike a size-class check — is fixed
 * for the process lifetime, so this doesn't flip mid-session as a Mac window
 * is resized. Other layouts use this seam for regular-width native Stack
 * header behavior; the custom tab bar itself stays in one cross-platform
 * geometry.
 */
export function isPadIdiom(): boolean {
  return isPadIdiomForPlatform(Platform);
}

/** Pure seam for navigation tests; avoids reloading React Native modules. */
export function isPadIdiomForPlatform(platform: { OS: string; isPad?: boolean }): boolean {
  return platform.OS === "ios" && platform.isPad === true;
}
