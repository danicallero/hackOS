import { useSyncExternalStore } from "react";

/** API contract: `503` with `error.code === "maintenance_in_progress"` (#539). */
export const MAINTENANCE_STATUS = 503;
export const MAINTENANCE_CODE = "maintenance_in_progress";

let phase: string | null = null;
const listeners = new Set<() => void>();

export function isMaintenance(status: number | undefined, code: string | undefined): boolean {
  return status === MAINTENANCE_STATUS && code === MAINTENANCE_CODE;
}

function set(next: string | null): void {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

/** A database restore holds the lock: the app shows its waiting screen. */
export function markMaintenance(nextPhase = "restoring"): void {
  set(nextPhase);
}

export function clearMaintenance(): void {
  set(null);
}

export function useMaintenancePhase(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => phase,
    () => null,
  );
}
