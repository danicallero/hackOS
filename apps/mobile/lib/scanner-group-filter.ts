import * as SecureStore from "expo-secure-store";
import type { ScannerPerson } from "@/lib/scanner-types";

const STORAGE_KEY = "scanner-role-filter";

/** H8/H27: use the same exact visible role names as the People directory. */
export function matchesScannerRole(person: Pick<ScannerPerson, "role">, roles: string[]): boolean {
  return roles.length === 0 || (person.role !== null && roles.includes(person.role));
}

/** H22: eligibility follows the live event entitlement, not application status. */
export function isAccreditationEligible(person: Pick<ScannerPerson, "eventAccess">): boolean {
  return person.eventAccess;
}

export async function loadScannerRoleFilter(): Promise<string[]> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

let writeQueue: Promise<void> = Promise.resolve();

export function saveScannerRoleFilter(roles: string[]): Promise<void> {
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(roles)));
  return writeQueue;
}
