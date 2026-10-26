import { maintenanceBodyKey, pollMaintenance } from "@hackos/shared/maintenance";
import { useEffect } from "react";

import { AuthHeader, AuthScreen } from "@/components/auth-ui";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { maintenanceStore } from "@/lib/maintenance";

/**
 * Blocking screen shown while a database restore holds the maintenance lock
 * (#539). It polls the lock-free status endpoint and hands control back to the
 * app as soon as the lock is gone.
 */
export function MaintenanceScreen({ phase }: { phase: string }) {
  const { t } = useLocale();

  useEffect(
    () =>
      pollMaintenance(API_URL, {
        onPhase: (next) => maintenanceStore.mark(next),
        onDone: () => maintenanceStore.clear(),
      }),
    [],
  );

  return (
    <AuthScreen>
      <AuthHeader
        icon="clock"
        title={t("maintenanceTitle")}
        description={t(maintenanceBodyKey(phase))}
      />
    </AuthScreen>
  );
}
