import {
  acknowledgeScan,
  correctScanTimestamp,
  deleteScan,
  enqueueLocalScan,
  failScan,
  markScanAttempt,
  noteRetryableError,
  pendingScans,
  retryScan,
  syncErrorHistory,
  wipeOfflineScanQueue,
} from "./scanner-db.web";
import type { ScanPayload } from "./scanner-types";

const OWNER_USER_ID = 101;
const OTHER_USER_ID = 202;

const payload: ScanPayload = {
  kind: "badge_removal",
  userId: 1,
  currentBadgeId: "B-1",
  reason: "test",
};

describe("web scanner queue ownership", () => {
  beforeEach(async () => {
    await wipeOfflineScanQueue(OWNER_USER_ID);
    await wipeOfflineScanQueue(OTHER_USER_ID);
  });

  it("does not allow another owner to update or delete a pending scan", async () => {
    const id = await enqueueLocalScan(payload, OWNER_USER_ID);
    const correctedPayload = { ...payload, reason: "wrong owner" };

    await markScanAttempt(id, OTHER_USER_ID);
    await acknowledgeScan(id, payload, OTHER_USER_ID);
    await failScan(id, "wrong owner", OTHER_USER_ID);
    await noteRetryableError(id, "wrong owner", OTHER_USER_ID);
    await correctScanTimestamp(id, OTHER_USER_ID, correctedPayload);
    await deleteScan(id, OTHER_USER_ID);

    expect(await pendingScans(OWNER_USER_ID)).toEqual([
      expect.objectContaining({
        id,
        payload,
        status: "pending",
        attempts: 0,
        lastError: null,
        clockCorrected: false,
      }),
    ]);
  });

  it("scopes retry to the owner even when the scan ID is known", async () => {
    const id = await enqueueLocalScan(payload, OWNER_USER_ID);

    await failScan(id, "business rejection", OWNER_USER_ID);
    await retryScan(id, OTHER_USER_ID);

    expect(await pendingScans(OWNER_USER_ID)).toEqual([
      expect.objectContaining({ id, status: "failed", lastError: "business rejection" }),
    ]);
  });

  it("keeps a deduplicated error history until the operator wipes the queue", async () => {
    const id = await enqueueLocalScan(payload, OWNER_USER_ID);

    await noteRetryableError(id, "temporary network error", OWNER_USER_ID);
    await noteRetryableError(id, "temporary network error", OWNER_USER_ID);
    await failScan(id, "server rejected the scan", OWNER_USER_ID);
    await deleteScan(id, OWNER_USER_ID);

    expect(await syncErrorHistory(OWNER_USER_ID)).toEqual([
      expect.objectContaining({
        scanId: id,
        type: "rejected",
        message: "server rejected the scan",
      }),
      expect.objectContaining({
        scanId: id,
        type: "retryable",
        message: "temporary network error",
      }),
    ]);

    await wipeOfflineScanQueue(OWNER_USER_ID);
    expect(await syncErrorHistory(OWNER_USER_ID)).toEqual([]);
  });
});
