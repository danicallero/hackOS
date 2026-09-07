import { ApiError, apiFetch, CLOCK_SKEW_TOLERANCE_MS, getClockSkewMs } from "./api";
import { authClient } from "./auth-client";
import { createIdempotencyKey } from "./idempotency-key";
import {
  acknowledgeScan,
  applyScannerSnapshot,
  correctScanTimestamp,
  deleteScan,
  enqueueLocalScan,
  failScan,
  markScanAttempt,
  noteRetryableError,
  pendingScans,
} from "./scanner-db";
import { requestForPendingScan, requestForScanPayload } from "./scanner-model";
import type { PendingScan, ScannerSnapshot, ScanPayload } from "./scanner-types";

interface SyncState {
  active: Promise<ScannerSyncResult> | null;
  rerunRequested: boolean;
  sessionCookie: string;
}

// The roster is disposable cache data. A native SQLite problem must not hold
// the online directory hostage, so only wait briefly for the best-effort
// write. The write keeps its error handler attached and may finish later.
const LOCAL_CACHE_TIMEOUT_MS = 1_500;
let activeLocalSnapshotWrite: Promise<void> | null = null;

export interface ScannerSyncResult {
  /** The server response is authoritative, even when the local cache fails. */
  snapshot: ScannerSnapshot;
  /** A local queue/roster problem that callers may surface while using snapshot. */
  localError: Error | null;
}

// A shared device can switch staff accounts while a network request is still
// running. Keep the coalescing state per owner so account B never receives
// account A's promise or causes account A's queue to replay under B's session
// (H54).
const syncStates = new Map<number, SyncState>();

export type ScannerMutationResult = {
  state: "acknowledged" | "queued";
  scanId: string;
};

/**
 * Send an operational scanner mutation while the server is reachable. SQLite
 * is a durable offline queue, not a prerequisite for an online mutation: a
 * broken local database must never prevent an accreditation from reaching the
 * authoritative API. The same idempotency key is retained if the transport
 * fails, so a later queue replay is safe even when the server processed the
 * request before the connection dropped.
 */
export async function submitScannerMutation(
  payload: ScanPayload,
  ownerUserId: number,
): Promise<ScannerMutationResult> {
  const scanId = createIdempotencyKey();
  const request = requestForScanPayload(payload, scanId);
  try {
    await apiFetch(request.path, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
      sessionCookie: authClient.getCookie(),
    });
    return { state: "acknowledged", scanId };
  } catch (cause) {
    // A real 4xx response is the server's verdict (missing capability,
    // invalid badge, conflict, etc.) and must be shown immediately. Network
    // failures and 5xx responses remain retryable and go to the offline queue.
    const status = cause instanceof ApiError && Number.isFinite(cause.status) ? cause.status : 0;
    if (status >= 400 && status < 500) throw cause;
    await enqueueLocalScan(payload, ownerUserId, scanId);
    return { state: "queued", scanId };
  }
}

function startLocalSnapshotWrite(snapshot: ScannerSnapshot, ownerUserId: number): Promise<void> {
  if (activeLocalSnapshotWrite) return activeLocalSnapshotWrite;
  // Promise.resolve also keeps this helper tolerant of a no-op web adapter or
  // a test double that returns void; the native implementation is async.
  const write = Promise.resolve(applyScannerSnapshot(snapshot, ownerUserId));
  const tracked = write.finally(() => {
    if (activeLocalSnapshotWrite === tracked) activeLocalSnapshotWrite = null;
  });
  activeLocalSnapshotWrite = tracked;
  return tracked;
}

async function waitForLocalSnapshotWrite(write: Promise<void>): Promise<Error | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race<Error | null>([
    write.then(
      () => null,
      (cause) => (cause instanceof Error ? cause : new Error("Local scanner storage failed")),
    ),
    new Promise<Error>((resolve) => {
      timeout = setTimeout(
        () => resolve(new Error("Local scanner storage timed out")),
        LOCAL_CACHE_TIMEOUT_MS,
      );
    }),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  return result;
}

/** Matches apps/api/src/modules/logistics/activities.ts BadRequestError text. */
const TIMESTAMP_FUTURE_ERROR = "Offline scan timestamp must be in the past";

type ReplayFailure = "retryable" | "terminal";

function classifyReplayFailure(error: unknown): ReplayFailure {
  if (!(error instanceof ApiError)) return "retryable";
  if (error instanceof ApiError && error.message.includes("still in flight")) {
    return "retryable";
  }
  if (
    error instanceof ApiError &&
    (error.status >= 500 || [401, 403, 408, 429].includes(error.status))
  ) {
    return "retryable";
  }
  return "terminal";
}

function isStaleCredentialRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    [
      "not_found",
      "badge_revoked",
      "badge_unknown",
      "ticket_revoked",
      "badge_scan_before_assignment",
    ].includes(error.code ?? "")
  );
}

async function replay(scan: PendingScan, sessionCookie: string): Promise<void> {
  const request = requestForPendingScan(scan);
  const isDelete = request.method === "DELETE";
  const headers = isDelete
    ? Object.fromEntries(Object.entries(request.headers).filter(([key]) => key !== "content-type"))
    : request.headers;
  await apiFetch(request.path, {
    method: request.method,
    headers,
    body: isDelete ? undefined : JSON.stringify(request.body),
    sessionCookie,
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
  sessionCookie: string,
): Promise<"not_attempted" | "acknowledged" | "retryable" | "terminal"> {
  if (scan.clockCorrected || !("scannedAt" in scan.payload)) return "not_attempted";
  const skewMs = getClockSkewMs();
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_TOLERANCE_MS) return "not_attempted";
  const corrected = {
    ...scan.payload,
    scannedAt: new Date(Date.parse(scan.payload.scannedAt) + skewMs).toISOString(),
  };
  await correctScanTimestamp(scan.id, ownerUserId, corrected);
  try {
    await replay({ ...scan, payload: corrected }, sessionCookie);
    await acknowledgeScan(scan.id, corrected, ownerUserId);
    return "acknowledged";
  } catch (error) {
    // The corrected retry is a real replay attempt and must use the same
    // terminal/retryable contract as the original attempt. Previously every
    // corrected failure returned `true`, which silently left the scan pending
    // on terminal errors and allowed transient failures to advance the queue.
    if (classifyReplayFailure(error) === "retryable") {
      await noteRetryableError(
        scan.id,
        error instanceof Error ? error.message : "Network error",
        ownerUserId,
      );
      return "retryable";
    }
    if (isStaleCredentialRejection(error)) {
      await deleteScan(scan.id, ownerUserId);
      return "terminal";
    }
    await failScan(
      scan.id,
      error instanceof Error ? error.message : "Request rejected",
      ownerUserId,
    );
    return "terminal";
  }
}

/**
 * Replays in original device order and stops after the first network error.
 * Scoped to a single owner (the currently signed-in staff member): a
 * predecessor's still-unsynced scans on this device are never replayed (and
 * would be replayed under the wrong session's authentication if they were —
 * see scanner-db.ts's per-user queue encryption/isolation).
 */
export async function replayPendingScans(
  ownerUserId: number,
  sessionCookie = authClient.getCookie(),
): Promise<void> {
  for (const scan of await pendingScans(ownerUserId, true)) {
    await markScanAttempt(scan.id, ownerUserId);
    try {
      await replay(scan, sessionCookie);
      await acknowledgeScan(scan.id, scan.payload, ownerUserId);
    } catch (error) {
      const failure = classifyReplayFailure(error);
      // Auth hiccups (expired session) and throttling are NOT verdicts on the
      // scan: failing them permanently silently loses every queued meal,
      // activity and presence log until someone finds the retry button. Only
      // genuine business rejections (400/404/409…) are final.
      if (failure === "retryable") {
        await noteRetryableError(
          scan.id,
          error instanceof Error ? error.message : "Network error",
          ownerUserId,
        );
        break;
      }
      // A 404 is terminal for a queued identity-bearing scan: the participant
      // or operation was removed before this device came back online. A
      // revoked/unknown badge is the explicit 409 variant of the same
      // condition, including the tombstone response after anonymization.
      // Delete the encrypted local payload instead of retaining it forever in
      // a failed queue entry.
      if (isStaleCredentialRejection(error)) {
        await deleteScan(scan.id, ownerUserId);
        continue;
      }
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        error.message.includes(TIMESTAMP_FUTURE_ERROR)
      ) {
        const correction = await attemptClockSkewCorrection(scan, ownerUserId, sessionCookie);
        if (correction === "acknowledged" || correction === "terminal") continue;
        if (correction === "retryable") break;
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await failScan(scan.id, error.message, ownerUserId);
        continue;
      }
      await noteRetryableError(
        scan.id,
        error instanceof Error ? error.message : "Network error",
        ownerUserId,
      );
      break;
    }
  }
}

async function doSync(ownerUserId: number, sessionCookie: string): Promise<ScannerSyncResult> {
  let localError: Error | null = null;
  // Mutations go first so the replace-all snapshot reflects acknowledged
  // writes and naturally rolls back any local optimistic state rejected by
  // the server.
  try {
    await replayPendingScans(ownerUserId, sessionCookie);
  } catch (cause) {
    // A broken offline queue must not prevent a connected scanner from
    // receiving the server's current directory. Keep the local failure for
    // the UI, but continue with the authoritative read below.
    localError = cause instanceof Error ? cause : new Error("Local scanner storage failed");
  }
  const snapshot = await apiFetch<ScannerSnapshot>("/api/scanner/snapshot", {
    sessionCookie,
  });
  // Do not make the server response depend on SQLite. A broken or locked
  // cache is reported to callers after a short grace period, while the
  // authoritative snapshot is still returned and rendered online.
  localError ??= await waitForLocalSnapshotWrite(startLocalSnapshotWrite(snapshot, ownerUserId));
  return { snapshot, localError };
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
export function synchronizeScanner(ownerUserId: number): Promise<ScannerSyncResult> {
  const sessionCookie = authClient.getCookie();
  const state =
    syncStates.get(ownerUserId) ??
    ({ active: null, rerunRequested: false, sessionCookie } satisfies SyncState);
  state.sessionCookie = sessionCookie;
  syncStates.set(ownerUserId, state);
  if (state.active) {
    state.rerunRequested = true;
    return state.active;
  }
  let run: Promise<ScannerSyncResult>;
  run = runUntilSettled(ownerUserId, state).finally(() => {
    if (state.active === run) state.active = null;
    if (state.active === null && !state.rerunRequested) syncStates.delete(ownerUserId);
  });
  state.active = run;
  return run;
}

async function runUntilSettled(ownerUserId: number, state: SyncState): Promise<ScannerSyncResult> {
  let result: ScannerSyncResult | null = null;
  do {
    state.rerunRequested = false;
    result = await doSync(ownerUserId, state.sessionCookie);
  } while (state.rerunRequested);
  return result;
}
