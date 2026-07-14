import type { PendingScan, ScannerPerson } from "./scanner-types";

/** Complete replace-all revocation set installed by each successful sync (H23). */
export function revokedBadgesFromSnapshot(snapshot: {
  people: Array<Pick<ScannerPerson, "revokedBadgeIds">>;
}): string[] {
  return [...new Set(snapshot.people.flatMap((person) => person.revokedBadgeIds))];
}

export function requestForPendingScan(scan: PendingScan): {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const headers = { "content-type": "application/json", "idempotency-key": scan.id };
  const payload = scan.payload;
  if (payload.kind === "accreditation") {
    return {
      path: "/api/accreditation/check-in",
      headers,
      body: { ticketToken: payload.ticketToken, badgeId: payload.badgeId, method: payload.method },
    };
  }
  if (payload.kind === "badge_rotation") {
    return {
      path: "/api/accreditation/rotate",
      headers,
      body: {
        userId: payload.userId,
        currentBadgeId: payload.currentBadgeId,
        newBadgeId: payload.newBadgeId,
        reason: payload.reason,
      },
    };
  }
  if (payload.kind === "presence") {
    return {
      path: "/api/presence/scan",
      headers,
      body: { badgeId: payload.badgeId, kind: payload.direction, scannedAt: payload.scannedAt },
    };
  }
  return {
    path: `/api/activities/${payload.activityId}/scan`,
    headers,
    body: {
      badgeId: payload.badgeId,
      allowRepeat: payload.allowRepeat,
      scannedAt: payload.scannedAt,
    },
  };
}
