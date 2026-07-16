jest.mock("./api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  },
}));

jest.mock("./scanner-db", () => ({
  acknowledgeScan: jest.fn(),
  applyScannerSnapshot: jest.fn(),
  failScan: jest.fn(),
  markScanAttempt: jest.fn(),
  noteRetryableError: jest.fn(),
  pendingScans: jest.fn(),
}));

import { ApiError, apiFetch } from "./api";
import { applyScannerSnapshot, failScan, noteRetryableError, pendingScans } from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan } from "./scanner-types";

const mockApiFetch = apiFetch as jest.Mock;
const mockPendingScans = pendingScans as jest.Mock;
const mockApplySnapshot = applyScannerSnapshot as jest.Mock;
const mockFailScan = failScan as jest.Mock;
const mockNoteRetryable = noteRetryableError as jest.Mock;
// The mocked ApiError constructor is (status, code, message).
const apiError = (status: number, message: string) =>
  new (ApiError as unknown as new (status: number, code: string, message: string) => Error)(
    status,
    "error",
    message,
  );

function badgeRemoval(id: string): PendingScan {
  return {
    id,
    kind: "badge_removal",
    payload: { kind: "badge_removal", userId: 1, currentBadgeId: "B-1", reason: "test" },
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: null,
  };
}

describe("synchronizeScanner", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockPendingScans.mockReset();
    mockApplySnapshot.mockReset();
    mockFailScan.mockReset();
    mockNoteRetryable.mockReset();
  });

  it("reruns for a caller who enqueues while a sync is already in flight", async () => {
    // First run sees no pending scans and resolves its /api/scanner/snapshot
    // fetch only once released, so we can enqueue a scan in the meantime
    // (mirroring an offline-first mutation racing the 15s background sync).
    let releaseFirstSnapshot!: () => void;
    const firstSnapshotGate = new Promise<void>((resolve) => {
      releaseFirstSnapshot = resolve;
    });

    mockPendingScans.mockResolvedValueOnce([]).mockResolvedValueOnce([badgeRemoval("scan-1")]);
    mockApiFetch.mockImplementationOnce(async () => {
      await firstSnapshotGate;
      return { generatedAt: "t0", people: [], activities: [], activityStates: [] };
    });

    const firstSync = synchronizeScanner();

    // Caller enqueues a mutation and asks to sync while the first run's
    // snapshot fetch is still pending.
    const secondSync = synchronizeScanner();

    releaseFirstSnapshot();
    // The replay for scan-1 (POST /api/accreditation/remove), then a second
    // snapshot fetch for the rerun.
    mockApiFetch.mockResolvedValueOnce({}).mockResolvedValueOnce({
      generatedAt: "t1",
      people: [],
      activities: [],
      activityStates: [],
    });

    await Promise.all([firstSync, secondSync]);

    // Both callers' promises only resolve once the rerun (which replays
    // scan-1) has completed.
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/accreditation/remove",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockApplySnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps scans queued through auth errors instead of failing them permanently", async () => {
    // An expired scanner session must never be a verdict on the scan itself:
    // failing it permanently silently loses the log (H24/H25/H26).
    mockPendingScans.mockResolvedValue([badgeRemoval("scan-1"), badgeRemoval("scan-2")]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(401, "Unauthorized"))
      // snapshot fetch after the replay loop breaks
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner();

    expect(mockFailScan).not.toHaveBeenCalled();
    expect(mockNoteRetryable).toHaveBeenCalledWith("scan-1", "Unauthorized");
    // The loop breaks: scan-2 is never attempted against a broken session.
    expect(mockApiFetch).not.toHaveBeenCalledWith(
      "/api/accreditation/remove",
      expect.objectContaining({ body: expect.stringContaining("scan-2") }),
    );
  });

  it("fails a scan permanently on a business rejection and continues the queue", async () => {
    mockPendingScans.mockResolvedValue([badgeRemoval("scan-1"), badgeRemoval("scan-2")]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(409, "No badge to remove"))
      .mockResolvedValueOnce({}) // scan-2 replay succeeds
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner();

    expect(mockFailScan).toHaveBeenCalledWith("scan-1", "No badge to remove");
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });
});
