import * as SecureStore from "expo-secure-store";
import type { ScannerPerson } from "@/lib/scanner-types";

/**
 * The scanner stats/people filter groups shown to the operator. "staff"
 * includes admins — they're the same operational group on the ground even
 * though the role enum keeps them distinct (see matchesScannerGroup below).
 */
export type ScannerGroup = "participant" | "mentor" | "staff" | "sponsor";

const STORAGE_KEY = "scanner-group-filter";

export function matchesScannerGroup(role: ScannerPerson["role"], groups: ScannerGroup[]): boolean {
  // An empty selection means "All" — no filtering.
  if (groups.length === 0) return true;
  return groups.some((group) =>
    group === "staff" ? role === "staff" || role === "admin" : role === group,
  );
}

export async function loadScannerGroupFilter(): Promise<ScannerGroup[]> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is ScannerGroup =>
      GROUP_VALUES.includes(value as ScannerGroup),
    );
  } catch {
    return [];
  }
}

export async function saveScannerGroupFilter(groups: ScannerGroup[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(groups));
}

const GROUP_VALUES: ScannerGroup[] = ["participant", "mentor", "staff", "sponsor"];
