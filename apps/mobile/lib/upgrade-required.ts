import { useSyncExternalStore } from "react";

/** API contract: `426` with `error.code === "upgrade_required"` (#999). */
export const UPGRADE_REQUIRED_STATUS = 426;
export const UPGRADE_REQUIRED_CODE = "upgrade_required";

let required = false;
const listeners = new Set<() => void>();

export function isUpgradeRequired(status: number | undefined, code: string | undefined): boolean {
  return status === UPGRADE_REQUIRED_STATUS && code === UPGRADE_REQUIRED_CODE;
}

/** The installed build is below the API's floor: the app stays blocked until it is updated. */
export function markUpgradeRequired(): void {
  if (required) return;
  required = true;
  for (const listener of listeners) listener();
}

export function useUpgradeRequired(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => required,
    () => false,
  );
}

/** Test seam: clears the latch between cases. */
export function resetUpgradeRequired(): void {
  required = false;
  for (const listener of listeners) listener();
}
