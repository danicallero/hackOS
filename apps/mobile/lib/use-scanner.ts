import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getScannerMeta, pendingScans, retryFailedScans } from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan } from "./scanner-types";

export function useScannerSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [queue, setQueue] = useState<PendingScan[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      setSyncing(false);
    }
  }, [refreshLocal]);

  const retryFailed = useCallback(async () => {
    await retryFailedScans();
    await sync();
  }, [sync]);

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

  return { syncing, lastSync, queue, error, sync, retryFailed, refreshLocal };
}
