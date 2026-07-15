import type { PendingScan, ScannerPerson } from "./scanner-types";

/** Complete replace-all revocation set installed by each successful sync (H23). */
export function revokedBadgesFromSnapshot(snapshot: {
  people: Array<Pick<ScannerPerson, "badgeId" | "revokedBadgeIds">>;
}): string[] {
  const active = new Set(
    snapshot.people.flatMap((person) => (person.badgeId ? [person.badgeId] : [])),
  );
  const revoked = new Set<string>();
  for (const person of snapshot.people) {
    for (const badgeId of person.revokedBadgeIds) {
      if (!active.has(badgeId)) revoked.add(badgeId);
    }
  }
  return [...revoked];
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
  if (payload.kind === "accreditation_user") {
    return {
      path: "/api/accreditation/check-in-user",
      headers,
      body: { userId: payload.userId, badgeId: payload.badgeId, method: payload.method },
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
  if (payload.kind === "badge_removal") {
    return {
      path: "/api/accreditation/remove",
      headers,
      body: { userId: payload.userId, reason: payload.reason },
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
