import type { PendingScan } from "./scanner-types";

export type ScannerTransactionState = "ready" | "saved" | "confirmed" | "attention";

/** Operator-facing state; transport details never masquerade as completion. */
export function scannerTransactionState(scan?: PendingScan | null): ScannerTransactionState {
  if (!scan) return "ready";
  if (scan.status === "acknowledged") return "confirmed";
  if (scan.status === "failed") return "attention";
  return "saved";
}

export function scannerQueueHealth(scans: PendingScan[]) {
  return scans.reduce(
    (health, scan) => {
      if (scan.status === "failed") health.attention += 1;
      else if (scan.status === "pending") {
        health.saved += 1;
        if (scan.lastError) health.offline += 1;
      } else health.confirmed += 1;
      return health;
    },
    { saved: 0, offline: 0, attention: 0, confirmed: 0 },
  );
}
