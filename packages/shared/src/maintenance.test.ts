import { describe, expect, it, vi } from "vitest";
import {
  createMaintenanceStore,
  isMaintenanceError,
  maintenanceBodyKey,
  maintenancePhaseOf,
} from "./maintenance";

describe("maintenance contract (#539)", () => {
  it("recognises only the restore-lock error", () => {
    expect(isMaintenanceError(503, "maintenance_in_progress")).toBe(true);
    expect(isMaintenanceError(503, "service_unavailable")).toBe(false);
    expect(isMaintenanceError(500, "maintenance_in_progress")).toBe(false);
  });

  it("reads the phase from error details, defaulting to restoring", () => {
    expect(maintenancePhaseOf({ phase: "failed" })).toBe("failed");
    expect(maintenancePhaseOf({})).toBe("restoring");
    expect(maintenancePhaseOf(undefined)).toBe("restoring");
  });

  it("picks the failure copy only for the failed phase", () => {
    expect(maintenanceBodyKey("failed")).toBe("maintenanceFailedBody");
    expect(maintenanceBodyKey("restoring")).toBe("maintenanceBody");
  });

  it("notifies subscribers only when the phase changes", () => {
    const store = createMaintenanceStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.mark();
    store.mark("restoring");
    store.mark("failed");
    store.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.get()).toBeNull();
    unsubscribe();
    store.mark();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
