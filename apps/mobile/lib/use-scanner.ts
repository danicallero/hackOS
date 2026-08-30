import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, getClockSkewMs } from "./api";
import { useMeContext } from "./me-context";
import {
  deleteScan,
  getScannerMeta,
  pendingScans,
  retryFailedScans,
  retryScan,
  syncErrorHistory,
} from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan, ScannerSyncErrorEntry } from "./scanner-types";

/** Sync stopped retrying automatically after this many straight failures. */
const MAX_AUTO_RETRIES = 3;
/**
 * Status codes that are NOT a verdict on the request itself (expired
 * session, request already in flight, rate limiting) — see the matching
 * list in scanner-sync.ts's replayPendingScans. Everything else in the 4xx
 * range is the server rejecting the sync outright (e.g. a conflict), and
 * retrying it unchanged on the next 15s tick would just reproduce it.
 */
const TRANSIENT_STATUSES = [401, 403, 408, 429];

export interface ScannerSyncError {
  message: string;
  /** A genuine server rejection (e.g. conflict) rather than a transient blip. */
  conflict: boolean;
}

/**
 * Every read/replay here is scoped to the currently signed-in staff member
 * (`me.id`) — the offline scan queue is encrypted and partitioned per user
 * (scanner-db.ts), so this hook only ever sees this operator's own pending
 * scans, never a predecessor's still-unsynced work on a shared device.
 */
export function useScannerSync() {
  const { me } = useMeContext();
  const ownerUserId = me?.id ?? null;

  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [queue, setQueue] = useState<PendingScan[]>([]);
  const [errorHistory, setErrorHistory] = useState<ScannerSyncErrorEntry[]>([]);
  const [error, setError] = useState<ScannerSyncError | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState<number | null>(null);
  const consecutiveFailures = useRef(0);
  // Read by the interval/AppState listener only — a manual retry (this
  // hook's `sync()` called directly, e.g. from a "retry" button) always goes
  // through regardless of this flag.
  const autoRetryPausedRef = useRef(false);
  const [autoRetryPaused, setAutoRetryPaused] = useState(false);

  const refreshLocal = useCallback(async () => {
    if (ownerUserId === null) return;
    const [meta, scans, errors] = await Promise.all([
      getScannerMeta(ownerUserId),
      pendingScans(ownerUserId),
      syncErrorHistory(ownerUserId),
    ]);
    setLastSync(meta.lastSync);
    setQueue(scans);
    setErrorHistory(errors);
  }, [ownerUserId]);

  const sync = useCallback(async () => {
    if (ownerUserId === null) return;
    setSyncing(true);
    try {
      await synchronizeScanner(ownerUserId);
      setError(null);
      consecutiveFailures.current = 0;
      autoRetryPausedRef.current = false;
      setAutoRetryPaused(false);
    } catch (cause) {
      const conflict =
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        !TRANSIENT_STATUSES.includes(cause.status);
      consecutiveFailures.current += 1;
      if (conflict || consecutiveFailures.current >= MAX_AUTO_RETRIES) {
        autoRetryPausedRef.current = true;
        setAutoRetryPaused(true);
      }
      setError({ message: cause instanceof Error ? cause.message : "Sync failed", conflict });
    } finally {
      await refreshLocal();
      setClockSkewMs(getClockSkewMs());
      setSyncing(false);
    }
  }, [ownerUserId, refreshLocal]);

  const retryFailed = useCallback(async () => {
    if (ownerUserId === null) return;
    await retryFailedScans(ownerUserId);
    await sync();
  }, [ownerUserId, sync]);

  /** Retries just the one scan the operator picked, rather than every failed entry in the queue. */
  const retryOne = useCallback(
    async (id: string) => {
      if (ownerUserId === null) return;
      await retryScan(id, ownerUserId);
      await sync();
    },
    [ownerUserId, sync],
  );

  /**
   * Manual, one-at-a-time discard for a scan the operator has given up
   * retrying (typically after logging it by hand in the web admin panel).
   * Never invoked automatically — there is no attempt-count threshold that
   * deletes a scan on its own, since a queued scan is the only record of
   * that transaction until it's acknowledged by the server.
   */
  const discardScan = useCallback(
    async (id: string) => {
      if (ownerUserId === null) return;
      await deleteScan(id, ownerUserId);
      await refreshLocal();
    },
    [ownerUserId, refreshLocal],
  );

  useEffect(() => {
    if (ownerUserId === null) return;
    void refreshLocal().then(sync);
    const interval = setInterval(() => {
      // Pausing auto-retry only skips the network attempt — local state
      // (the queue, including scans enqueued from another screen's own
      // useScannerSync instance) still needs to keep refreshing, or a
      // paused screen goes stale and stops showing newly queued scans at
      // all until a manual retry.
      if (autoRetryPausedRef.current) void refreshLocal();
      else void sync();
    }, 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (autoRetryPausedRef.current) void refreshLocal();
      else void sync();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [ownerUserId, refreshLocal, sync]);

  return {
    syncing,
    lastSync,
    queue,
    errorHistory,
    error,
    autoRetryPaused,
    clockSkewMs,
    sync,
    retryFailed,
    retryOne,
    discardScan,
    refreshLocal,
  };
}
