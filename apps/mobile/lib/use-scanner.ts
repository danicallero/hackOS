import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getClockSkewMs } from "./api";
import { deleteScan, getScannerMeta, pendingScans, retryFailedScans } from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan } from "./scanner-types";

export function useScannerSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [queue, setQueue] = useState<PendingScan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clockSkewMs, setClockSkewMs] = useState<number | null>(null);

  const refreshLocal = useCallback(async () => {
    const [meta, scans] = await Promise.all([getScannerMeta(), pendingScans()]);
    setLastSync(meta.lastSync);
    setQueue(scans);
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await synchronizeScanner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed");
    } finally {
      await refreshLocal();
      setClockSkewMs(getClockSkewMs());
      setSyncing(false);
    }
  }, [refreshLocal]);

  const retryFailed = useCallback(async () => {
    await retryFailedScans();
    await sync();
  }, [sync]);

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
    void refreshLocal().then(sync);
    const interval = setInterval(() => void sync(), 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refreshLocal, sync]);

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
