import { requestForPendingScan, revokedBadgesFromSnapshot } from "./scanner-model";
import type { PendingScan } from "./scanner-types";

function pending(payload: PendingScan["payload"]): PendingScan {
  return {
    id: "stable-device-id",
    kind: payload.kind,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: null,
    clockCorrected: false,
  };
}

describe("offline scanner contract", () => {
  it("replays with the persisted scan id as the server idempotency key", () => {
    const request = requestForPendingScan(
      pending({
        kind: "presence",
        badgeId: "B-1",
        direction: "in",
        scannedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(request.path).toBe("/api/presence/scan");
    expect(request.headers["idempotency-key"]).toBe("stable-device-id");
    expect(request.body).toEqual({
      badgeId: "B-1",
      kind: "in",
      scannedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("installs every rotated-away badge in the replacement revocation set", () => {
    const snapshot = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      people: [
        { userId: 1, badgeId: "ACTIVE-1", revokedBadgeIds: ["OLD-1", "OLD-2"] },
        { userId: 2, badgeId: "ACTIVE-2", revokedBadgeIds: ["OLD-2", "OLD-3"] },
      ],
      activities: [],
      activityStates: [],
    };
    expect(revokedBadgesFromSnapshot(snapshot)).toEqual(["OLD-1", "OLD-2", "OLD-3"]);
  });

  it("never marks a currently assigned badge as revoked when it also appears in history", () => {
    const snapshot = {
      people: [
        { badgeId: "REUSED", revokedBadgeIds: [] },
        { badgeId: "CURRENT-2", revokedBadgeIds: ["REUSED", "OLD"] },
      ],
    };
    expect(revokedBadgesFromSnapshot(snapshot)).toEqual(["OLD"]);
  });

  it("replays accreditation removal through its idempotent endpoint", () => {
    const request = requestForPendingScan(
      pending({
        kind: "badge_removal",
        userId: 42,
        currentBadgeId: "BADGE-42",
        reason: "Damaged",
      }),
    );
    expect(request.path).toBe("/api/accreditation/remove");
    expect(request.body).toEqual({ userId: 42, reason: "Damaged" });
    expect(request.headers["idempotency-key"]).toBe("stable-device-id");
  });

  it("replays manual user accreditation through the user endpoint", () => {
    const request = requestForPendingScan(
      pending({
        kind: "accreditation_user",
        userId: 42,
        badgeId: "BADGE-42",
        method: "manual",
      }),
    );
    expect(request.path).toBe("/api/accreditation/check-in-user");
    expect(request.body).toEqual({ userId: 42, badgeId: "BADGE-42", method: "manual" });
  });
});
