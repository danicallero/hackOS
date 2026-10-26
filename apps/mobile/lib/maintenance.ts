import { createMaintenanceStore } from "@hackos/shared/maintenance";
import { useSyncExternalStore } from "react";

export const maintenanceStore = createMaintenanceStore();

export function useMaintenancePhase(): string | null {
  return useSyncExternalStore(maintenanceStore.subscribe, maintenanceStore.get, () => null);
}
