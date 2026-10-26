import { useSyncExternalStore } from "react";

/** API contract: `503` with `error.code === "maintenance_in_progress"` (#539). */
export const MAINTENANCE_STATUS = 503;
export const MAINTENANCE_CODE = "maintenance_in_progress";

export interface MaintenanceView {
  phase: string;
}

let current: MaintenanceView | null = null;
const listeners = new Set<() => void>();

export function isMaintenanceError(status: number | undefined, code: string | undefined): boolean {
  return status === MAINTENANCE_STATUS && code === MAINTENANCE_CODE;
}

/** A restore holds the lock: the app shows its waiting screen until it ends. */
export function markMaintenance(view: MaintenanceView): void {
  if (current?.phase === view.phase) return;
  current = view;
  for (const listener of listeners) listener();
}

export function clearMaintenance(): void {
  if (!current) return;
  current = null;
  for (const listener of listeners) listener();
}

export function useMaintenance(): MaintenanceView | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
}
