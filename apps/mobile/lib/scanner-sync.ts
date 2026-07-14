import { ApiError, apiFetch } from "./api";
import {
  acknowledgeScan,
  applyScannerSnapshot,
  failScan,
  markScanAttempt,
  noteRetryableError,
  pendingScans,
} from "./scanner-db";
import { requestForPendingScan } from "./scanner-model";
import type { PendingScan, ScannerSnapshot } from "./scanner-types";

let activeSync: Promise<void> | null = null;

async function replay(scan: PendingScan): Promise<void> {
  const request = requestForPendingScan(scan);
  await apiFetch(request.path, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
}

/** Replays in original device order and stops after the first network error. */
export async function replayPendingScans(): Promise<void> {
  for (const scan of await pendingScans(true)) {
    await markScanAttempt(scan.id);
    try {
      await replay(scan);
      await acknowledgeScan(scan.id, scan.payload);
    } catch (error) {
      if (error instanceof ApiError && error.message.includes("still in flight")) {
        await noteRetryableError(scan.id, error.message);
        break;
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await failScan(scan.id, error.message);
        continue;
      }
      await noteRetryableError(scan.id, error instanceof Error ? error.message : "Network error");
      break;
    }
  }
}

async function doSync(): Promise<void> {
  // Mutations go first so the replace-all snapshot reflects acknowledged
  // writes and naturally rolls back any local optimistic state rejected by
  // the server.
  await replayPendingScans();
  const snapshot = await apiFetch<ScannerSnapshot>("/api/scanner/snapshot");
  await applyScannerSnapshot(snapshot);
}

export function synchronizeScanner(): Promise<void> {
  if (!activeSync) {
    activeSync = doSync().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}
