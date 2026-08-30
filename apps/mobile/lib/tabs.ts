import { CAPABILITIES } from "@hackos/shared/capabilities";
import { Platform } from "react-native";
import type { OverflowTabKey } from "./overflow-tabs";

export type TabKey = "schedule" | "notifications" | "scan" | "activities" | OverflowTabKey;

export interface PersonalTabContext {
  accredited: boolean;
  hasQueueItems: boolean;
}

const NO_PERSONAL_QUEUE: PersonalTabContext = { accredited: false, hasQueueItems: false };

export function canSeeMyQueue(context: PersonalTabContext): boolean {
  return context.accredited || context.hasQueueItems;
}

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

/** Staff members with access to their personal logistics statistics. */
export function canViewStaffStatistics(capabilities: string[]): boolean {
  return isOperator(capabilities) || has(capabilities, CAPABILITIES.LOGISTICS_STATS);
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
 * H22/H55: which tabs a signed-in user sees, driven by effective capabilities
 * and concrete personal-resource facts (never by illustrative `role`).
 */
export function visibleTabs(
  capabilities: string[],
  context: PersonalTabContext = NO_PERSONAL_QUEUE,
): TabKey[] {
  return [...primaryTabs(capabilities, context), ...overflowTabs(capabilities, context)];
}

/**
 * Tabs shown directly in the custom tab bar. My queue is a personal resource,
 * so it appears only after accreditation or real queue membership. The bar reserves a separate
 * Others circle only when the complete set is crowded. Operators prioritize
 * their daily tools here; five destinations fit directly, while larger sets
 * use four direct tabs plus Others.
 */
export function primaryTabs(
  capabilities: string[],
  context: PersonalTabContext = NO_PERSONAL_QUEUE,
): TabKey[] {
  if (queueOperationsInPrimaryBar(capabilities)) {
    return ["schedule", "operations", "notifications"];
  }
  if (!isOperator(capabilities)) {
    return [
      "schedule",
      ...(canSeeMyQueue(context) ? (["queue"] as const) : []),
      "wallet",
      "notifications",
    ];
  }

  return [
    "schedule",
    "scan",
    ...(canScanActivities(capabilities) ? (["activities"] as const) : []),
    "notifications",
  ];
}

/** Tabs represented inside the Others selector rather than the main bar. */
export function overflowTabs(
  capabilities: string[],
  context: PersonalTabContext = NO_PERSONAL_QUEUE,
): OverflowTabKey[] {
  if (!isOperator(capabilities) && !canOperateQueues(capabilities)) return ["account"];
  return [
    ...(canSeeMyQueue(context) ? (["queue"] as const) : []),
    "wallet",
    "account",
    ...(isOperator(capabilities) && canOperateQueues(capabilities)
      ? (["operations"] as const)
      : []),
  ];
}

/** True only when the complete tab set cannot fit as five direct destinations. */
export function shouldUseOverflowMenu(
  capabilities: string[],
  context: PersonalTabContext = NO_PERSONAL_QUEUE,
): boolean {
  // Five destinations still fit as ordinary direct tabs. Others is reserved
  // for a genuinely crowded navigation set, where the bar keeps four direct
  // cells and moves the remaining destinations behind the native menu.
  return visibleTabs(capabilities, context).length > 5;
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
