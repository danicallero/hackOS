import { useEffect } from "react";

import { AuthHeader, AuthScreen } from "@/components/auth-ui";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { clearMaintenance, markMaintenance } from "@/lib/maintenance";

const POLL_MS = 10_000;

/**
 * Blocking screen shown while a database restore holds the maintenance lock
 * (#539). It polls the lock-free status endpoint and hands control back to the
 * app as soon as the lock is gone.
 */
export function MaintenanceScreen({ phase }: { phase: string }) {
  const { t } = useLocale();

  useEffect(() => {
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL.replace(/\/+$/, "")}/api/public/maintenance`);
        const status = (await res.json()) as { active?: boolean; phase?: string };
        if (stopped) return;
        if (status.active === false) clearMaintenance();
        else if (status.phase) markMaintenance(status.phase);
      } catch {
        // The API may be restarting; keep waiting.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <AuthScreen>
      <AuthHeader
        icon="clock"
        title={t("maintenanceTitle")}
        description={t(phase === "failed" ? "maintenanceFailedBody" : "maintenanceBody")}
      />
    </AuthScreen>
  );
}
