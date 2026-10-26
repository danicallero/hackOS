"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { clearMaintenance, markMaintenance, useMaintenance } from "@/lib/maintenance";

const POLL_MS = 10_000;

/**
 * Replaces the whole app with a waiting screen while a database restore holds
 * the maintenance lock (#539). It is armed by the first `503
 * maintenance_in_progress` any request sees, polls the lock-free status
 * endpoint, and reloads once the lock is gone so no stale state survives the
 * restore.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const maintenance = useMaintenance();
  const active = maintenance !== null;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/public/maintenance`, {
          credentials: "omit",
          cache: "no-store",
        });
        const status = (await res.json()) as { active?: boolean; phase?: string };
        if (stopped) return;
        if (status.active === false) {
          clearMaintenance();
          window.location.reload();
        } else if (status.active && status.phase) {
          markMaintenance({ phase: status.phase });
        }
      } catch {
        // The API itself may be restarting; keep waiting.
      }
    };
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);

  if (!maintenance) return <>{children}</>;
  return <MaintenanceScreen failed={maintenance.phase === "failed"} />;
}

function MaintenanceScreen({ failed }: { failed: boolean }) {
  const { t } = useLocale();
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
          {t(failed ? "maintenanceFailedBody" : "maintenanceBody")}
        </p>
        {!failed && (
          <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </section>
    </main>
  );
}
