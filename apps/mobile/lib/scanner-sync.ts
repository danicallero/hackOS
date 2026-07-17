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
let rerunRequested = false;

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
      // Auth hiccups (expired session) and throttling are NOT verdicts on the
      // scan: failing them permanently silently loses every queued meal,
      // activity and presence log until someone finds the retry button. Only
      // genuine business rejections (400/404/409…) are final.
      if (error instanceof ApiError && [401, 403, 408, 429].includes(error.status)) {
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

/**
 * A caller that enqueues a mutation and immediately awaits this must be sure
 * that mutation gets replayed — not just see a snapshot that was already
 * in flight before the enqueue, which would silently revert their optimistic
 * local write until the next sync cycle. So a request that arrives while a
 * sync is running doesn't just piggyback on it: it marks a rerun, and the
 * shared promise only resolves once a run that started after the request has
 * completed.
 */
export function synchronizeScanner(): Promise<void> {
  if (activeSync) {
    rerunRequested = true;
    return activeSync;
  }
  activeSync = runUntilSettled();
  return activeSync;
}

async function runUntilSettled(): Promise<void> {
  try {
    do {
      rerunRequested = false;
      await doSync();
    } while (rerunRequested);
  } finally {
    activeSync = null;
  }
}
