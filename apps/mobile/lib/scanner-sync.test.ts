jest.mock("./api", () => ({
  apiFetch: jest.fn(),
  getClockSkewMs: jest.fn(() => null),
  CLOCK_SKEW_TOLERANCE_MS: 60_000,
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

jest.mock("./auth-client", () => ({
  authClient: { getCookie: jest.fn(() => "session=staff-a") },
}));

jest.mock("./scanner-db", () => ({
  acknowledgeScan: jest.fn(),
  applyScannerSnapshot: jest.fn(),
  correctScanTimestamp: jest.fn(),
  deleteScan: jest.fn(),
  failScan: jest.fn(),
  markScanAttempt: jest.fn(),
  noteRetryableError: jest.fn(),
  pendingScans: jest.fn(),
}));

import { ApiError, apiFetch, getClockSkewMs } from "./api";
import { authClient } from "./auth-client";
import {
  acknowledgeScan,
  applyScannerSnapshot,
  correctScanTimestamp,
  deleteScan,
  failScan,
  noteRetryableError,
  pendingScans,
} from "./scanner-db";
import { synchronizeScanner } from "./scanner-sync";
import type { PendingScan } from "./scanner-types";

const mockApiFetch = apiFetch as jest.Mock;
const mockPendingScans = pendingScans as jest.Mock;
const mockApplySnapshot = applyScannerSnapshot as jest.Mock;
const mockFailScan = failScan as jest.Mock;
const mockNoteRetryable = noteRetryableError as jest.Mock;
const mockGetClockSkewMs = getClockSkewMs as jest.Mock;
const mockCorrectScanTimestamp = correctScanTimestamp as jest.Mock;
const mockAcknowledgeScan = acknowledgeScan as jest.Mock;
const mockDeleteScan = deleteScan as jest.Mock;
const mockGetCookie = authClient.getCookie as jest.Mock;
const OWNER_USER_ID = 42;
// The mocked ApiError constructor is (status, code, message).
const apiError = (status: number, message: string, code = "error") =>
  new (ApiError as unknown as new (status: number, code: string, message: string) => Error)(
    status,
    code,
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
    clockCorrected: false,
  };
}

function presenceScan(id: string, scannedAt = "2026-01-01T00:00:00.000Z"): PendingScan {
  return {
    id,
    kind: "presence",
    payload: { kind: "presence", badgeId: "B-1", direction: "in", scannedAt },
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: scannedAt,
    acknowledgedAt: null,
    clockCorrected: false,
  };
}

describe("synchronizeScanner", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockPendingScans.mockReset();
    mockApplySnapshot.mockReset();
    mockFailScan.mockReset();
    mockNoteRetryable.mockReset();
    mockGetClockSkewMs.mockReset().mockReturnValue(null);
    mockCorrectScanTimestamp.mockReset();
    mockAcknowledgeScan.mockReset();
    mockDeleteScan.mockReset();
    mockGetCookie.mockReset().mockReturnValue("session=staff-a");
  });

  it("keeps an in-flight replay bound to the session that started it", async () => {
    const firstScan = badgeRemoval("scan-a");
    const requests: { path: string; sessionCookie: string | undefined }[] = [];
    let releaseFirstReplay!: () => void;
    const firstReplayGate = new Promise<void>((resolve) => {
      releaseFirstReplay = resolve;
    });
    let firstRequestStarted!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      firstRequestStarted = resolve;
    });

    mockPendingScans.mockImplementation(async (ownerUserId: number) =>
      ownerUserId === OWNER_USER_ID ? [firstScan] : [],
    );
    mockApiFetch.mockImplementation(async (path: string, init?: { sessionCookie?: string }) => {
      requests.push({ path, sessionCookie: init?.sessionCookie });
      if (requests.length === 1) {
        firstRequestStarted();
        await firstReplayGate;
      }
      return path === "/api/scanner/snapshot"
        ? { generatedAt: "t0", people: [], activities: [], activityStates: [] }
        : {};
    });

    const firstSync = synchronizeScanner(OWNER_USER_ID);
    await firstRequest;

    // A different staff member signs in while staff A's network request is
    // still suspended. Their sync must use B's queue and session, while the
    // already-started A request remains pinned to A's captured cookie.
    mockGetCookie.mockReturnValue("session=staff-b");
    const secondSync = synchronizeScanner(7);
    await secondSync;

    releaseFirstReplay();
    await firstSync;

    expect(requests).toEqual([
      { path: "/api/accreditation/remove", sessionCookie: "session=staff-a" },
      { path: "/api/scanner/snapshot", sessionCookie: "session=staff-b" },
      { path: "/api/scanner/snapshot", sessionCookie: "session=staff-a" },
    ]);
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

    const firstSync = synchronizeScanner(OWNER_USER_ID);

    // Caller enqueues a mutation and asks to sync while the first run's
    // snapshot fetch is still pending.
    const secondSync = synchronizeScanner(OWNER_USER_ID);

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

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockFailScan).not.toHaveBeenCalled();
    expect(mockNoteRetryable).toHaveBeenCalledWith("scan-1", "Unauthorized", OWNER_USER_ID);
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

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockFailScan).toHaveBeenCalledWith("scan-1", "No badge to remove", OWNER_USER_ID);
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });

  it("drops a queued scan for a credential revoked while the device was offline", async () => {
    mockPendingScans.mockResolvedValue([badgeRemoval("scan-revoked")]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(409, "This ticket has been revoked", "ticket_revoked"))
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockDeleteScan).toHaveBeenCalledWith("scan-revoked", OWNER_USER_ID);
    expect(mockFailScan).not.toHaveBeenCalled();
  });

  it("drops a queued scan when anonymization makes its badge unknown", async () => {
    mockPendingScans.mockResolvedValue([presenceScan("scan-anonymized")]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(409, "Badge not found", "badge_unknown"))
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockDeleteScan).toHaveBeenCalledWith("scan-anonymized", OWNER_USER_ID);
    expect(mockFailScan).not.toHaveBeenCalled();
  });

  it("corrects a timestamp rejected as future by the measured clock skew and retries once", async () => {
    // Device clock is 5 minutes ahead of the server's.
    mockGetClockSkewMs.mockReturnValue(-5 * 60_000);
    const scan = presenceScan("scan-1", "2026-01-01T00:05:00.000Z");
    mockPendingScans.mockResolvedValue([scan]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(400, "Offline scan timestamp must be in the past"))
      .mockResolvedValueOnce({}) // corrected retry succeeds
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockCorrectScanTimestamp).toHaveBeenCalledWith(
      "scan-1",
      OWNER_USER_ID,
      expect.objectContaining({ scannedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(mockFailScan).not.toHaveBeenCalled();
    expect(mockAcknowledgeScan).toHaveBeenCalled();
  });

  it("fails a scan permanently if it's still rejected as future after a clock-skew correction", async () => {
    mockGetClockSkewMs.mockReturnValue(-5 * 60_000);
    const scan = { ...presenceScan("scan-1"), clockCorrected: true };
    mockPendingScans.mockResolvedValue([scan]);
    mockApiFetch
      .mockRejectedValueOnce(apiError(400, "Offline scan timestamp must be in the past"))
      .mockResolvedValueOnce({ generatedAt: "t0", people: [], activities: [], activityStates: [] });

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockCorrectScanTimestamp).not.toHaveBeenCalled();
    expect(mockFailScan).toHaveBeenCalledWith(
      "scan-1",
      "Offline scan timestamp must be in the past",
      OWNER_USER_ID,
    );
  });

  it("clears the in-flight lock after a failed sync so the next call retries the network", async () => {
    // A snapshot fetch failure (e.g. offline) must not wedge the shared
    // activeSync promise: pressing the sync button again has to attempt the
    // network again, not silently resolve a stale rejected promise.
    mockPendingScans.mockResolvedValue([]);
    mockApiFetch.mockRejectedValueOnce(new Error("Network error"));

    await expect(synchronizeScanner(OWNER_USER_ID)).rejects.toThrow("Network error");

    mockApiFetch.mockResolvedValueOnce({
      generatedAt: "t0",
      people: [],
      activities: [],
      activityStates: [],
    });

    await synchronizeScanner(OWNER_USER_ID);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });
});
