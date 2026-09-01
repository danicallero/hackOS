import * as Network from "expo-network";
import { useEffect } from "react";

const HEALTH_POLL_MS = 15_000;

/**
 * Re-runs `retry` as soon as the device regains network connectivity, and
 * falls back to polling every 15s while `active` — some platforms deliver
 * `addNetworkStateListener` unreliably (e.g. a captive network that reports
 * "connected" without real internet), so the request itself is the real
 * health check, not just the radio state.
 */
export function useRetryOnReconnect(active: boolean, retry: () => void): void {
  useEffect(() => {
    if (!active) return;
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected) retry();
    });
    const interval = setInterval(retry, HEALTH_POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [active, retry]);
}
