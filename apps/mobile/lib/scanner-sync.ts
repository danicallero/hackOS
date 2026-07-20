import { ApiError, apiFetch, CLOCK_SKEW_TOLERANCE_MS, getClockSkewMs } from "./api";
import {
  acknowledgeScan,
  applyScannerSnapshot,
  correctScanTimestamp,
  failScan,
  markScanAttempt,
  noteRetryableError,
  pendingScans,
} from "./scanner-db";
import { requestForPendingScan } from "./scanner-model";
import type { PendingScan, ScannerSnapshot } from "./scanner-types";

let activeSync: Promise<void> | null = null;
let rerunRequested = false;

/** Matches apps/api/src/modules/logistics/activities.ts BadRequestError text. */
const TIMESTAMP_FUTURE_ERROR = "Offline scan timestamp must be in the past";

async function replay(scan: PendingScan): Promise<void> {
  const request = requestForPendingScan(scan);
  await apiFetch(request.path, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
}

/**
 * A scan rejected for having a "future" timestamp because the device clock
 * runs ahead of the server's would otherwise be stuck forever: the queue
 * only ever resubmits the same stored payload, so a plain retry reproduces
 * the identical rejection. Rather than discarding the originally logged
 * time, shift it by the measured clock skew and retry once — a scan that
 * still fails after that correction is a genuine business rejection (e.g. a
 * deliberately backdated entry) and is failed permanently as before.
 */
async function attemptClockSkewCorrection(
  scan: PendingScan,
  ownerUserId: number,
): Promise<boolean> {
  if (scan.clockCorrected || !("scannedAt" in scan.payload)) return false;
  const skewMs = getClockSkewMs();
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_TOLERANCE_MS) return false;
  const corrected = {
    ...scan.payload,
    scannedAt: new Date(Date.parse(scan.payload.scannedAt) + skewMs).toISOString(),
  };
  await correctScanTimestamp(scan.id, ownerUserId, corrected);
  try {
    await replay({ ...scan, payload: corrected });
    await acknowledgeScan(scan.id, corrected);
  } catch {
    // Correction didn't resolve it; fall through to normal handling on the
    // next sync pass (clockCorrected is now set, so it won't loop).
  }
  return true;
}

/**
 * Replays in original device order and stops after the first network error.
 * Scoped to a single owner (the currently signed-in staff member): a
 * predecessor's still-unsynced scans on this device are never replayed (and
 * would be replayed under the wrong session's authentication if they were —
 * see scanner-db.ts's per-user queue encryption/isolation).
 */
export async function replayPendingScans(ownerUserId: number): Promise<void> {
  for (const scan of await pendingScans(ownerUserId, true)) {
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
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        error.message.includes(TIMESTAMP_FUTURE_ERROR) &&
        (await attemptClockSkewCorrection(scan, ownerUserId))
      ) {
        continue;
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

async function doSync(ownerUserId: number): Promise<void> {
  // Mutations go first so the replace-all snapshot reflects acknowledged
  // writes and naturally rolls back any local optimistic state rejected by
  // the server.
  await replayPendingScans(ownerUserId);
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
export function synchronizeScanner(ownerUserId: number): Promise<void> {
  if (activeSync) {
    rerunRequested = true;
    return activeSync;
  }
  activeSync = runUntilSettled(ownerUserId);
  return activeSync;
}

async function runUntilSettled(ownerUserId: number): Promise<void> {
  try {
    do {
      rerunRequested = false;
      await doSync(ownerUserId);
    } while (rerunRequested);
  } finally {
    activeSync = null;
  }
}
