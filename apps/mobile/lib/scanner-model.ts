import type { PendingScan, ScannerPerson, ScanPayload } from "./scanner-types";

/** Complete replace-all revocation set installed by each successful sync (H23). */
export function revokedBadgesFromSnapshot(snapshot: {
  revokedBadgeIds?: string[];
  people: Array<Pick<ScannerPerson, "badgeId" | "revokedBadgeIds">>;
}): string[] {
  const active = new Set(
    snapshot.people.flatMap((person) => (person.badgeId ? [person.badgeId] : [])),
  );
  const revoked = new Set(snapshot.revokedBadgeIds ?? []);
  for (const person of snapshot.people) {
    for (const badgeId of person.revokedBadgeIds ?? []) {
      if (!active.has(badgeId)) revoked.add(badgeId);
    }
  }
  return [...revoked];
}

export function requestForScanPayload(
  payload: ScanPayload,
  idempotencyKey: string,
): {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  const headers = { "content-type": "application/json", "idempotency-key": idempotencyKey };
  if (payload.kind === "accreditation") {
    return {
      path: "/api/accreditation/check-in",
      method: "POST",
      headers,
      body: {
        ticketToken: payload.ticketToken,
        badgeId: payload.badgeId,
        method: payload.method,
        assignedAt: payload.assignedAt,
      },
    };
  }
  if (payload.kind === "accreditation_user") {
    return {
      path: "/api/accreditation/check-in-user",
      method: "POST",
      headers,
      body: {
        userId: payload.userId,
        badgeId: payload.badgeId,
        method: payload.method,
        attendeeRole: payload.attendeeRole,
        assignedAt: payload.assignedAt,
      },
    };
  }
  if (payload.kind === "badge_rotation") {
    return {
      path: "/api/accreditation/rotate",
      method: "POST",
      headers,
      body: {
        userId: payload.userId,
        currentBadgeId: payload.currentBadgeId,
        newBadgeId: payload.newBadgeId,
        reason: payload.reason,
        assignedAt: payload.assignedAt,
      },
    };
  }
  if (payload.kind === "badge_removal") {
    return {
      path: "/api/accreditation/remove",
      method: "POST",
      headers,
      body: { userId: payload.userId, reason: payload.reason },
    };
  }
  if (payload.kind === "presence") {
    return {
      path: "/api/presence/scan",
      method: "POST",
      headers,
      body: { badgeId: payload.badgeId, kind: payload.direction, scannedAt: payload.scannedAt },
    };
  }
  if (payload.kind === "presence_signal") {
    return {
      path: `/api/presence/signals/${payload.userId}`,
      method: "POST",
      headers,
      body: { kind: payload.direction, occurredAt: payload.occurredAt, notes: payload.notes },
    };
  }
  if (payload.kind === "presence_signal_activity") {
    return {
      path: `/api/presence/signals/${payload.userId}`,
      method: "POST",
      headers,
      body: {
        kind: "activity",
        activityId: payload.activityId,
        occurredAt: payload.occurredAt,
        notes: payload.notes,
      },
    };
  }
  if (payload.kind === "presence_signal_edit_door") {
    return {
      path: `/api/presence/logs/${payload.logId}`,
      method: "PATCH",
      headers,
      body: { kind: payload.direction, scannedAt: payload.occurredAt, notes: payload.notes },
    };
  }
  if (payload.kind === "presence_signal_edit_activity") {
    return {
      path: `/api/presence/activity-logs/${payload.logId}`,
      method: "PATCH",
      headers,
      body: {
        activityId: payload.activityId,
        occurredAt: payload.occurredAt,
        notes: payload.notes,
      },
    };
  }
  if (payload.kind === "presence_signal_delete") {
    return {
      path:
        payload.source === "door"
          ? `/api/presence/logs/${payload.logId}`
          : `/api/presence/activity-logs/${payload.logId}`,
      method: "DELETE",
      headers,
      body: {},
    };
  }
  return {
    path: `/api/activities/${payload.activityId}/scan`,
    method: "POST",
    headers,
    body: {
      badgeId: payload.badgeId,
      ticketToken: payload.ticketToken,
      expectedUserId: payload.expectedUserId,
      allowRepeat: payload.allowRepeat,
      scannedAt: payload.scannedAt,
    },
  };
}

export function requestForPendingScan(scan: PendingScan): {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body: Record<string, unknown>;
  headers: Record<string, string>;
} {
  return requestForScanPayload(scan.payload, scan.id);
}

/**
 * H22/H25: a badge assigned on this device but not yet synced is still real for the
 * operator. Returns who the queued accreditation (or rotation) gave the badge to, so a
 * later scan can be accepted now and reconciled on replay (the API rejects it if the
 * badge went to someone else).
 */
export function pendingBadgeClaim(
  queue: readonly PendingScan[],
  badgeId: string,
): { userId: number } | { ticketToken: string } | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const scan = queue[index];
    if (scan.status !== "pending") continue;
    const { payload } = scan;
    if (!payload) continue;
    if (payload.kind === "accreditation_user" && payload.badgeId === badgeId) {
      return { userId: payload.userId };
    }
    if (payload.kind === "badge_rotation" && payload.newBadgeId === badgeId) {
      return { userId: payload.userId };
    }
    if (payload.kind === "accreditation" && payload.badgeId === badgeId) {
      return { ticketToken: payload.ticketToken };
    }
  }
  return null;
}
