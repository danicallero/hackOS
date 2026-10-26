import { createMaintenanceStore } from "@hackos/shared/maintenance";

// React-free on purpose: `lib/api.ts` is also imported by server components.
export const maintenanceStore = createMaintenanceStore();
