import { useCallback, useEffect, useState } from "react";
import { liveActivityHost } from "./host";
import { liveActivitiesEnabled, setLiveActivitiesEnabled } from "./sync";

/** The in-app Live Activity opt-out (#966) behind Notifications settings. */
export function useLiveActivitiesSetting() {
  const available = liveActivityHost.platform !== null && liveActivityHost.supported();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void liveActivitiesEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, [available]);

  const toggle = useCallback(async (next: boolean) => {
    setEnabled(next);
    setBusy(true);
    try {
      await setLiveActivitiesEnabled(next);
    } catch {
      // The local choice is saved and local surfaces already follow it; the
      // device registration is re-sent on the next sign-in or foreground.
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    available: available && enabled !== null,
    platform: liveActivityHost.platform,
    enabled: enabled ?? true,
    busy,
    toggle,
  };
}
