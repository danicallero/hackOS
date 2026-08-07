import { File, Paths } from "expo-file-system";

import { clearOfflineCache, getOfflineCacheBytes } from "./offline-cache";
import { wipeAttendanceRoster } from "./scanner-db";

export interface StorageUsage {
  /** Offline API fallback cache (schedule, wallet, notifications — see offline-cache.ts). */
  offlineDataBytes: number;
  /** Downloaded/derived files sitting in the OS-managed cache dir (wallet passes, attendance roster). */
  downloadedFilesBytes: number;
  totalBytes: number;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const offlineDataBytes = await getOfflineCacheBytes();
  const downloadedFilesBytes = getCacheDirectoryBytes();
  return {
    offlineDataBytes,
    downloadedFilesBytes,
    totalBytes: offlineDataBytes + downloadedFilesBytes,
  };
}

function getCacheDirectoryBytes(): number {
  try {
    return Paths.cache.size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Clears every disposable cache: the offline API fallback, downloaded wallet
 * passes, and (for operators) the attendance roster. Deliberately leaves the
 * offline scan queue alone — see scanner-db.ts — since it's the only record
 * of not-yet-synced transactions until they reach the server.
 */
export async function clearAllCaches(operator: boolean): Promise<void> {
  await clearOfflineCache();
  clearDownloadedFiles();
  if (operator) await wipeAttendanceRoster();
}

function clearDownloadedFiles(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.extension === ".pkpass") entry.delete();
    }
  } catch {
    // Best-effort: clearing downloaded files must never throw into the UI.
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value < 10 && unitIndex > 0 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}
