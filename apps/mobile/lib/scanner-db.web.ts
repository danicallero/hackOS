import type {
  PendingScan,
  ScannerActivity,
  ScannerActivityState,
  ScannerPerson,
  ScannerSnapshot,
  ScannerSyncErrorEntry,
  ScanPayload,
} from "./scanner-types";

// Web is a preview surface, not an operational offline scanner. Keeping a
// small in-memory adapter preserves route rendering without pretending to
// offer restart-safe storage; native builds resolve scanner-db.native.ts and
// use encrypted SQLite (roster + per-user queue) durability. The signatures
// here still mirror the native module's owner-scoping so both platforms
// share callers unchanged.
let snapshot: ScannerSnapshot = {
  generatedAt: "",
  revokedBadgeIds: [],
  revokedTicketTokens: [],
  people: [],
  activities: [],
  activityStates: [],
};
let scans: (PendingScan & { ownerUserId: number })[] = [];
let syncErrors: (ScannerSyncErrorEntry & { ownerUserId: number })[] = [];
let nextSyncErrorId = 1;

function recordSyncError(
  scan: PendingScan & { ownerUserId: number },
  message: string,
  type: ScannerSyncErrorEntry["type"],
) {
  syncErrors.push({
    id: nextSyncErrorId++,
    scanId: scan.id,
    ownerUserId: scan.ownerUserId,
    kind: scan.kind,
    type,
    message,
    occurredAt: new Date().toISOString(),
  });
}

export async function applyScannerSnapshot(
  next: ScannerSnapshot,
  _ownerUserId?: number,
): Promise<void> {
  snapshot = next;
}

export async function wipeAttendanceRoster(): Promise<void> {
  snapshot = {
    generatedAt: "",
    revokedBadgeIds: [],
    revokedTicketTokens: [],
    people: [],
    activities: [],
    activityStates: [],
  };
}

export async function findPersonByTicket(ticketToken: string): Promise<ScannerPerson | null> {
  if (snapshot.revokedTicketTokens?.includes(ticketToken)) return null;
  return snapshot.people.find((person) => person.ticketToken === ticketToken) ?? null;
}

export async function findPersonById(userId: number): Promise<ScannerPerson | null> {
  return snapshot.people.find((person) => person.userId === userId) ?? null;
}

export async function listScannerPeople(query = ""): Promise<ScannerPerson[]> {
  const needle = query.trim().toLocaleLowerCase();
  return snapshot.people
    .filter((person) =>
      [person.name, person.surname, person.email, person.badgeId]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    )
    .sort((a, b) =>
      [a.surname, a.name, a.userId]
        .join(" ")
        .localeCompare([b.surname, b.name, b.userId].join(" ")),
    );
}

export async function findPersonByBadge(
  badgeId: string,
): Promise<{ person: ScannerPerson | null; revoked: boolean }> {
  if (snapshot.revokedBadgeIds?.includes(badgeId)) {
    return { person: null, revoked: true };
  }
  const person = snapshot.people.find((candidate) => candidate.badgeId === badgeId) ?? null;
  if (person) return { person, revoked: false };
  const revoked = snapshot.people.some((person) =>
    (person.revokedBadgeIds ?? []).includes(badgeId),
  );
  return {
    person: null,
    revoked,
  };
}

export async function listScannerActivities(): Promise<ScannerActivity[]> {
  return [...snapshot.activities].sort((a, b) => {
    if (a.startsAt !== b.startsAt) {
      if (a.startsAt === null) return 1;
      if (b.startsAt === null) return -1;
      return a.startsAt.localeCompare(b.startsAt);
    }
    return a.name.localeCompare(b.name) || a.id - b.id;
  });
}

export async function getActivityState(
  userId: number,
  activityId: number,
): Promise<ScannerActivityState> {
  return (
    snapshot.activityStates.find(
      (state) => state.userId === userId && state.activityId === activityId,
    ) ?? { userId, activityId, count: 0 }
  );
}

export async function enqueueLocalScan(payload: ScanPayload, ownerUserId: number): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  scans.push({
    id,
    kind: payload.kind,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    acknowledgedAt: null,
    clockCorrected: false,
    ownerUserId,
  });
  return id;
}

export async function pendingScans(
  ownerUserId: number,
  onlyPending = false,
): Promise<PendingScan[]> {
  return scans.filter(
    (scan) => scan.ownerUserId === ownerUserId && (!onlyPending || scan.status === "pending"),
  );
}

export async function markScanAttempt(id: string, ownerUserId: number): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id && scan.ownerUserId === ownerUserId
      ? { ...scan, attempts: scan.attempts + 1, lastError: null }
      : scan,
  );
}

export async function acknowledgeScan(
  id: string,
  _payload: ScanPayload,
  ownerUserId: number,
): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id && scan.ownerUserId === ownerUserId
      ? { ...scan, status: "acknowledged", acknowledgedAt: new Date().toISOString() }
      : scan,
  );
}

export async function failScan(id: string, message: string, ownerUserId: number): Promise<void> {
  scans = scans.map((scan) => {
    if (scan.id !== id || scan.ownerUserId !== ownerUserId) return scan;
    if (scan.status === "failed" && scan.lastError === message) return scan;
    const failed = { ...scan, status: "failed" as const, lastError: message };
    recordSyncError(failed, message, "rejected");
    return failed;
  });
}

export async function noteRetryableError(
  id: string,
  message: string,
  ownerUserId: number,
): Promise<void> {
  scans = scans.map((scan) => {
    if (scan.id !== id || scan.ownerUserId !== ownerUserId) return scan;
    if (scan.lastError === message) return scan;
    const noted = { ...scan, lastError: message };
    recordSyncError(noted, message, "retryable");
    return noted;
  });
}

export async function correctScanTimestamp(
  id: string,
  ownerUserId: number,
  payload: ScanPayload,
): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id && scan.ownerUserId === ownerUserId
      ? { ...scan, payload, clockCorrected: true, lastError: null }
      : scan,
  );
}

export async function retryFailedScans(ownerUserId: number): Promise<void> {
  scans = scans.map((scan) =>
    scan.ownerUserId === ownerUserId && scan.status === "failed"
      ? { ...scan, status: "pending", lastError: null }
      : scan,
  );
}

/** Same as retryFailedScans, scoped to a single scan the operator picked from the queue. */
export async function retryScan(id: string, ownerUserId: number): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id && scan.ownerUserId === ownerUserId && scan.status === "failed"
      ? { ...scan, status: "pending", lastError: null }
      : scan,
  );
}

export async function deleteScan(id: string, ownerUserId: number): Promise<void> {
  scans = scans.filter((scan) => scan.id !== id || scan.ownerUserId !== ownerUserId);
}

export async function wipeOfflineScanQueue(ownerUserId: number): Promise<void> {
  scans = scans.filter((scan) => scan.ownerUserId !== ownerUserId);
  syncErrors = syncErrors.filter((entry) => entry.ownerUserId !== ownerUserId);
}

export async function syncErrorHistory(ownerUserId: number): Promise<ScannerSyncErrorEntry[]> {
  return syncErrors
    .filter((entry) => entry.ownerUserId === ownerUserId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id)
    .map(({ ownerUserId: _ownerUserId, ...entry }) => entry);
}

export async function getScannerMeta(
  ownerUserId: number,
): Promise<{ lastSync: string | null; pending: number }> {
  return {
    lastSync: snapshot.generatedAt || null,
    pending: scans.filter((scan) => scan.ownerUserId === ownerUserId && scan.status === "pending")
      .length,
  };
}
