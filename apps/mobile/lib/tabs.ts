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
 * Tabs shown directly in the platform tab bar. Only ever four destinations
 * plus, at most, one overflow slot — a native
 * `UITabBarController` silently collapses everything past its fifth item
 * into its own system "More" screen, which bypasses our overflow menu
 * entirely. Operators prioritize their daily tools here and keep the less
 * frequently used personal destinations in the overflow selector.
 */
export function primaryTabs(capabilities: string[]): TabKey[] {
  if (queueOperationsInPrimaryBar(capabilities)) {
    return ["schedule", "operations", "notifications"];
  }
  if (!isOperator(capabilities)) return [...PARTICIPANT_PRIMARY_TAB_KEYS, "account"];

  return [
    "schedule",
    "scan",
    ...(canScanActivities(capabilities) ? (["activities"] as const) : []),
    "notifications",
  ];
}

/** Tabs represented inside the native Others selector rather than the main bar. */
export function overflowTabs(capabilities: string[]): OverflowTabKey[] {
  if (!isOperator(capabilities) && !canOperateQueues(capabilities)) return [];
  return [
    "queue",
    "wallet",
    "account",
    ...(isOperator(capabilities) && canOperateQueues(capabilities)
      ? (["operations"] as const)
      : []),
  ];
}

/** True whenever any tab lives outside the primary bar and needs the overflow selector. */
export function shouldUseOverflowMenu(capabilities: string[]): boolean {
  return overflowTabs(capabilities).length > 0;
}

/**
 * True on real iPad hardware, and identically true for this same iPad build
 * running "Designed for iPad" on an Apple Silicon Mac — UIKit reports both
 * as the `.pad` interface idiom. Either way `NativeTabs` abandons iPhone's
 * fixed bottom bar for a top-anchored bar (regular-width UITabBarController
 * adaptivity, see WWDC24 "Elevate your tab and sidebar experience in
 * iPadOS"), so screen-position math tuned for the bottom bar no longer
 * lines up with anything real. Idiom — unlike a size-class check — is fixed
 * for the process lifetime, so this doesn't flip mid-session as a Mac
 * window is resized.
 */
export function isPadIdiom(): boolean {
  return isPadIdiomForPlatform(Platform);
}

/** Pure seam for navigation tests; avoids reloading React Native modules. */
export function isPadIdiomForPlatform(platform: { OS: string; isPad?: boolean }): boolean {
  return platform.OS === "ios" && platform.isPad === true;
}
