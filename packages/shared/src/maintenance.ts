/**
 * Contract shared by the API gate and the web and mobile waiting screens while
 * a database restore holds the maintenance lock (#539).
 */
export const MAINTENANCE_STATUS = 503;
export const MAINTENANCE_CODE = "maintenance_in_progress";
export const MAINTENANCE_STATUS_PATH = "/api/public/maintenance";
export const MAINTENANCE_POLL_MS = 10_000;
export const MAINTENANCE_DEFAULT_PHASE = "restoring";
export const MAINTENANCE_FAILED_PHASE = "failed";

export type MaintenanceStatusResponse =
  | { active: false }
  | {
      active: true;
      phase: string;
      restoreId: string | null;
      startedAt: string | null;
      etaAt: string | null;
    };

export function isMaintenanceError(status: number | undefined, code: string | undefined): boolean {
  return status === MAINTENANCE_STATUS && code === MAINTENANCE_CODE;
}

/** The phase carried in the error's `details`, or the default when absent. */
export function maintenancePhaseOf(details: unknown): string {
  const phase = (details as { phase?: unknown } | null | undefined)?.phase;
  return typeof phase === "string" && phase ? phase : MAINTENANCE_DEFAULT_PHASE;
}

/** i18n key of the explanation shown for a phase; both clients use the same copy. */
export function maintenanceBodyKey(phase: string): "maintenanceBody" | "maintenanceFailedBody" {
  return phase === MAINTENANCE_FAILED_PHASE ? "maintenanceFailedBody" : "maintenanceBody";
}

export async function fetchMaintenanceStatus(
  apiUrl: string,
  init?: RequestInit,
): Promise<MaintenanceStatusResponse> {
  let base = apiUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const res = await fetch(`${base}${MAINTENANCE_STATUS_PATH}`, { cache: "no-store", ...init });
  return (await res.json()) as MaintenanceStatusResponse;
}

export interface MaintenanceStore {
  get(): string | null;
  /** A restore holds the lock: clients show their waiting screen. */
  mark(phase?: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

/** Framework-free store; each client wraps it in `useSyncExternalStore`. */
export function createMaintenanceStore(): MaintenanceStore {
  let phase: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (phase === next) return;
    phase = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => phase,
    mark: (next = MAINTENANCE_DEFAULT_PHASE) => set(next),
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Polls until the lock is gone. `onPhase` receives each still-active phase
 * (e.g. `failed`); `onDone` fires once when the lock is released.
 */
export function pollMaintenance(
  apiUrl: string,
  handlers: { onPhase(phase: string): void; onDone(): void },
  init?: RequestInit,
): () => void {
  let stopped = false;
  const timer = setInterval(async () => {
    try {
      const status = await fetchMaintenanceStatus(apiUrl, init);
      if (stopped) return;
      if (status.active) handlers.onPhase(status.phase);
      else handlers.onDone();
    } catch {
      // The API itself may be restarting; keep waiting.
    }
  }, MAINTENANCE_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
