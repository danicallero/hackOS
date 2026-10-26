"use client";

import { maintenanceBodyKey, pollMaintenance } from "@hackos/shared/maintenance";
import { useEffect } from "react";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { maintenanceStore, useMaintenancePhase } from "@/lib/maintenance";

/**
 * Replaces the whole app with a waiting screen while a database restore holds
 * the maintenance lock (#539). It is armed by the first `503
 * maintenance_in_progress` any request sees, polls the lock-free status
 * endpoint, and reloads once the lock is gone so no stale state survives the
 * restore.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const phase = useMaintenancePhase();
  const active = phase !== null;

  useEffect(() => {
    if (!active) return;
    return pollMaintenance(
      API_URL,
      {
        onPhase: (next) => maintenanceStore.mark(next),
        onDone: () => {
          maintenanceStore.clear();
          window.location.reload();
        },
      },
      { credentials: "omit" },
    );
  }, [active]);

  return phase === null ? <>{children}</> : <MaintenanceScreen phase={phase} />;
}

function MaintenanceScreen({ phase }: { phase: string }) {
  const { t } = useLocale();
  const bodyKey = maintenanceBodyKey(phase);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <section
        aria-labelledby="maintenance-title"
        className="w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-sm"
      >
        <p className="text-primary text-sm font-semibold">hackOS</p>
        <h1 id="maintenance-title" className="text-balance text-2xl font-semibold">
          {t("maintenanceTitle")}
        </h1>
        <p role="status" className="text-muted-foreground text-pretty">
          {t(bodyKey)}
        </p>
        {bodyKey === "maintenanceBody" && (
          <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </section>
    </main>
  );
}
