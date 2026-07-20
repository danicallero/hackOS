import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getClockSkewMs } from "./api";
import { useMeContext } from "./me-context";
import { deleteScan, getScannerMeta, pendingScans, retryFailedScans } from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan } from "./scanner-types";

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
  const [error, setError] = useState<string | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState<number | null>(null);

  const refreshLocal = useCallback(async () => {
    if (ownerUserId === null) return;
    const [meta, scans] = await Promise.all([
      getScannerMeta(ownerUserId),
      pendingScans(ownerUserId),
    ]);
    setLastSync(meta.lastSync);
    setQueue(scans);
  }, [ownerUserId]);

  const sync = useCallback(async () => {
    if (ownerUserId === null) return;
    setSyncing(true);
    setError(null);
    try {
      await synchronizeScanner(ownerUserId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed");
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

  /**
   * Manual, one-at-a-time discard for a scan the operator has given up
   * retrying (typically after logging it by hand in the web admin panel).
   * Never invoked automatically — there is no attempt-count threshold that
   * deletes a scan on its own, since a queued scan is the only record of
   * that transaction until it's acknowledged by the server.
   */
  const discardScan = useCallback(
    async (id: string) => {
      await deleteScan(id);
      await refreshLocal();
    },
    [refreshLocal],
  );

  useEffect(() => {
    if (ownerUserId === null) return;
    void refreshLocal().then(sync);
    const interval = setInterval(() => void sync(), 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
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
    error,
    clockSkewMs,
    sync,
    retryFailed,
    discardScan,
    refreshLocal,
  };
}
