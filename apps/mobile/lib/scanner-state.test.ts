import { scannerQueueHealth, scannerTransactionState } from "./scanner-state";
import type { PendingScan } from "./scanner-types";

function scan(status: PendingScan["status"], lastError: string | null = null): PendingScan {
  return {
    id: `${status}-${lastError ?? "clean"}`,
    kind: "presence",
    payload: {
      kind: "presence",
      badgeId: "B-1",
      direction: "in",
      scannedAt: "2026-01-01T00:00:00.000Z",
    },
    status,
    attempts: 1,
    lastError,
    createdAt: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: status === "acknowledged" ? "2026-01-01T00:00:01.000Z" : null,
    clockCorrected: false,
  };
}

describe("scanner transaction presentation", () => {
  it("never presents a durable pending scan as confirmed", () => {
    expect(scannerTransactionState(scan("pending"))).toBe("saved");
    expect(scannerTransactionState(scan("pending", "Network request failed"))).toBe("saved");
  });

  it("distinguishes acknowledgement from business rejection", () => {
    expect(scannerTransactionState(scan("acknowledged"))).toBe("confirmed");
    expect(scannerTransactionState(scan("failed", "Badge revoked"))).toBe("attention");
  });

  it("reports offline-pending and rejected work separately", () => {
    expect(
      scannerQueueHealth([
        scan("pending"),
        scan("pending", "Network request failed"),
        scan("failed", "Badge revoked"),
        scan("acknowledged"),
      ]),
    ).toEqual({ saved: 2, offline: 1, attention: 1, confirmed: 1 });
  });
});
