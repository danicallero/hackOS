import { useCallback, useEffect, useRef, useState } from "react";
import { liveActivityHost } from "./host";
import { liveActivitiesEnabled, setLiveActivitiesEnabled } from "./sync";

/** The in-app Live Activity opt-out (#966) behind Notifications settings. */
export function useLiveActivitiesSetting() {
  const available = liveActivityHost.platform !== null && liveActivityHost.supported();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(available);
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    retryAction.current = load;
    try {
      setEnabled(await liveActivitiesEnabled());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (next: boolean) => {
    retryAction.current = () => toggle(next);
    setError(null);
    setEnabled(next);
    setBusy(true);
    try {
      await setLiveActivitiesEnabled(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      // The local choice is saved and local surfaces already follow it; the
      // device registration is re-sent on the next sign-in or foreground.
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    loading,
    error,
    retry: () => {
      if (retryAction.current) void retryAction.current();
    },
    available: available && enabled !== null,
    platform: liveActivityHost.platform,
    enabled: enabled ?? true,
    busy,
    toggle,
  };
}
