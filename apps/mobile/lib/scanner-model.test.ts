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
        { userId: 1, revokedBadgeIds: ["OLD-1", "OLD-2"] },
        { userId: 2, revokedBadgeIds: ["OLD-2", "OLD-3"] },
      ],
      activities: [],
      activityStates: [],
    };
    expect(revokedBadgesFromSnapshot(snapshot)).toEqual(["OLD-1", "OLD-2", "OLD-3"]);
  });
});
