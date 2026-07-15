import type {
  PendingScan,
  ScannerActivity,
  ScannerActivityState,
  ScannerPerson,
  ScannerSnapshot,
  ScanPayload,
} from "./scanner-types";

// Web is a preview surface, not an operational offline scanner. Keeping a
// small in-memory adapter preserves route rendering without pretending to
// offer restart-safe storage; native builds resolve scanner-db.native.ts and
// use SQLite WAL durability.
let snapshot: ScannerSnapshot = {
  generatedAt: "",
  people: [],
  activities: [],
  activityStates: [],
};
let scans: PendingScan[] = [];

export async function applyScannerSnapshot(next: ScannerSnapshot): Promise<void> {
  snapshot = next;
}

export async function findPersonByTicket(ticketToken: string): Promise<ScannerPerson | null> {
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
  const person = snapshot.people.find((candidate) => candidate.badgeId === badgeId) ?? null;
  if (person) return { person, revoked: false };
  const revoked = snapshot.people.some((person) => person.revokedBadgeIds.includes(badgeId));
  return {
    person: null,
    revoked,
  };
}

export async function listScannerActivities(): Promise<ScannerActivity[]> {
  return snapshot.activities;
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

export async function enqueueLocalScan(payload: ScanPayload): Promise<string> {
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
  });
  return id;
}

export async function pendingScans(onlyPending = false): Promise<PendingScan[]> {
  return scans.filter((scan) => !onlyPending || scan.status === "pending");
}

export async function markScanAttempt(id: string): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id ? { ...scan, attempts: scan.attempts + 1, lastError: null } : scan,
  );
}

export async function acknowledgeScan(id: string): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id
      ? { ...scan, status: "acknowledged", acknowledgedAt: new Date().toISOString() }
      : scan,
  );
}

export async function failScan(id: string, message: string): Promise<void> {
  scans = scans.map((scan) =>
    scan.id === id ? { ...scan, status: "failed", lastError: message } : scan,
  );
}

export async function noteRetryableError(id: string, message: string): Promise<void> {
  scans = scans.map((scan) => (scan.id === id ? { ...scan, lastError: message } : scan));
}

export async function retryFailedScans(): Promise<void> {
  scans = scans.map((scan) =>
    scan.status === "failed" ? { ...scan, status: "pending", lastError: null } : scan,
  );
}

export async function getScannerMeta(): Promise<{ lastSync: string | null; pending: number }> {
  return {
    lastSync: snapshot.generatedAt || null,
    pending: scans.filter((scan) => scan.status === "pending").length,
  };
}
