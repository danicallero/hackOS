import { Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import {
  decryptJson,
  encryptJson,
  getQueueKey,
  getRosterKey,
  resetRosterKey,
} from "./scanner-crypto";
import { revokedBadgesFromSnapshot } from "./scanner-model";
import type {
  PendingScan,
  ScannerActivity,
  ScannerActivityState,
  ScannerPerson,
  ScannerSnapshot,
  ScanPayload,
} from "./scanner-types";

/**
 * Two physical SQLite files, deliberately kept apart:
 *
 * - The roster (this event's people/badges/activities) lives in the cache
 *   directory, which the OS excludes from iCloud/Google auto-backups, and is
 *   wiped in full on sign-out (wipeAttendanceRoster). It's disposable: a
 *   fresh GET /api/scanner/snapshot always reconstructs it.
 * - The offline scan queue is durable (the only record of a not-yet-synced
 *   transaction), so it stays in the default document directory and is
 *   never wiped on logout — see queue.native.ts-style ownership notes below.
 *
 * Every sensitive field is stored AES-256-GCM encrypted (scanner-crypto.ts);
 * only the columns needed for O(1) scan lookups (ticket_token, badge_id,
 * created_by_user_id) stay in plaintext.
 */

let rosterDatabase: Promise<SQLite.SQLiteDatabase> | null = null;
let queueDatabase: Promise<SQLite.SQLiteDatabase> | null = null;

interface PersonPayload {
  email: string;
  role: ScannerPerson["role"];
  name: string | null;
  surname: string | null;
  accepted: boolean;
  confirmed: boolean;
  intolerances: ScannerPerson["intolerances"];
  foodIntoleranceNotes: string | null;
  notes: string | null;
  lastPresenceKind: "in" | "out" | null;
  lastPresenceAt: string | null;
}

async function rosterDb(): Promise<SQLite.SQLiteDatabase> {
  if (!rosterDatabase) {
    rosterDatabase = SQLite.openDatabaseAsync(
      "hackos-scanner-roster.db",
      undefined,
      Paths.cache.uri,
    ).then(async (opened) => {
      await opened.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS scanner_people (
          user_id INTEGER PRIMARY KEY,
          ticket_token TEXT UNIQUE,
          badge_id TEXT UNIQUE,
          encrypted_payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS revoked_badges (badge_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS scanner_activities (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          requires_scan INTEGER NOT NULL,
          starts_at TEXT
        );
        CREATE TABLE IF NOT EXISTS scanner_activity_states (
          user_id INTEGER NOT NULL,
          activity_id INTEGER NOT NULL,
          scan_count INTEGER NOT NULL,
          PRIMARY KEY (user_id, activity_id)
        );
        CREATE TABLE IF NOT EXISTS scanner_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      return opened;
    });
  }
  return rosterDatabase;
}

async function queueDb(): Promise<SQLite.SQLiteDatabase> {
  if (!queueDatabase) {
    queueDatabase = SQLite.openDatabaseAsync("hackos-scanner-queue.db").then(async (opened) => {
      await opened.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS pending_scans (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          created_by_user_id INTEGER NOT NULL,
          encrypted_payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          acknowledged_at TEXT,
          clock_corrected INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS pending_scans_owner_status
          ON pending_scans(created_by_user_id, status, created_at);
      `);
      await migrateLegacyQueue(opened);
      return opened;
    });
  }
  return queueDatabase;
}

/**
 * One-time upgrade path for devices that synced before the roster/queue
 * split and per-user queue encryption. The old combined `hackos-scanner.db`
 * kept pending_scans as plaintext JSON with no owner column; any such rows
 * are attributed to a sentinel "unknown owner" (userId 0) rather than
 * silently dropped, then the legacy file is deleted. Devices that never had
 * the old file (fresh installs) hit this as a harmless no-op.
 */
async function migrateLegacyQueue(target: SQLite.SQLiteDatabase): Promise<void> {
  let legacy: SQLite.SQLiteDatabase | null = null;
  try {
    legacy = await SQLite.openDatabaseAsync("hackos-scanner.db");
    const columns = await legacy.getAllAsync<{ name: string }>(`PRAGMA table_info(pending_scans)`);
    const hasLegacyShape = columns.some((c) => c.name === "payload_json");
    if (!hasLegacyShape) return;
    const rows = await legacy.getAllAsync<{
      id: string;
      kind: PendingScan["kind"];
      payload_json: string;
      status: PendingScan["status"];
      attempts: number;
      last_error: string | null;
      created_at: string;
      acknowledged_at: string | null;
      clock_corrected: number;
    }>(`SELECT * FROM pending_scans`);
    if (rows.length > 0) {
      const key = await getQueueKey(0);
      for (const row of rows) {
        const encrypted = await encryptJson(JSON.parse(row.payload_json), key);
        await target.runAsync(
          `INSERT OR IGNORE INTO pending_scans
            (id, kind, created_by_user_id, encrypted_payload, status, attempts, last_error, created_at, acknowledged_at, clock_corrected)
           VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.kind,
          encrypted,
          row.status,
          row.attempts,
          row.last_error,
          row.created_at,
          row.acknowledged_at,
          row.clock_corrected,
        );
      }
    }
  } catch {
    // No legacy database, or it's already in the new shape — nothing to do.
  } finally {
    if (legacy) {
      await legacy.closeAsync();
      await SQLite.deleteDatabaseAsync("hackos-scanner.db").catch(() => undefined);
    }
  }
}

let rosterTransactionChain: Promise<unknown> = Promise.resolve();
let queueTransactionChain: Promise<unknown> = Promise.resolve();

// SQLite allows one transaction per connection: concurrent withTransactionAsync
// calls on the same file interleave BEGINs and fail. Every transaction against
// a given database runs through its own serialized queue.
function withSerializedTransaction<T>(
  chainRef: { chain: Promise<unknown> },
  database: SQLite.SQLiteDatabase,
  work: () => Promise<T>,
): Promise<T> {
  const run = chainRef.chain.then(async () => {
    let result: T | undefined;
    await database.withTransactionAsync(async () => {
      result = await work();
    });
    return result as T;
  });
  chainRef.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const rosterChainRef = {
  get chain() {
    return rosterTransactionChain;
  },
  set chain(value: Promise<unknown>) {
    rosterTransactionChain = value;
  },
};
const queueChainRef = {
  get chain() {
    return queueTransactionChain;
  },
  set chain(value: Promise<unknown>) {
    queueTransactionChain = value;
  },
};

export async function applyScannerSnapshot(snapshot: ScannerSnapshot): Promise<void> {
  const database = await rosterDb();
  const key = await getRosterKey();
  const encryptedPeople = await Promise.all(
    snapshot.people.map(async (person) => ({
      person,
      encrypted: await encryptJson(
        {
          email: person.email ?? "",
          role: person.role ?? "participant",
          name: person.name,
          surname: person.surname,
          accepted: person.accepted ?? person.confirmed,
          confirmed: person.confirmed,
          intolerances: person.intolerances,
          foodIntoleranceNotes: person.foodIntoleranceNotes,
          notes: person.notes,
          lastPresenceKind: person.lastPresenceKind,
          lastPresenceAt: person.lastPresenceAt,
        } satisfies PersonPayload,
        key,
      ),
    })),
  );
  await withSerializedTransaction(rosterChainRef, database, async () => {
    const statements = [
      `
      DELETE FROM scanner_people;
      DELETE FROM revoked_badges;
      DELETE FROM scanner_activities;
      DELETE FROM scanner_activity_states;
    `,
    ];
    for (const { person, encrypted } of encryptedPeople) {
      statements.push(`INSERT INTO scanner_people
          (user_id, ticket_token, badge_id, encrypted_payload)
         VALUES (${sqlLiteral(person.userId)}, ${sqlLiteral(person.ticketToken)},
                 ${sqlLiteral(person.badgeId)}, ${sqlLiteral(encrypted)});`);
    }
    for (const revoked of revokedBadgesFromSnapshot(snapshot)) {
      statements.push(`INSERT INTO revoked_badges (badge_id) VALUES (${sqlLiteral(revoked)});`);
    }
    for (const activity of snapshot.activities) {
      statements.push(`INSERT INTO scanner_activities (id, name, category, requires_scan, starts_at)
        VALUES (${sqlLiteral(activity.id)}, ${sqlLiteral(activity.name)},
                ${sqlLiteral(activity.category)}, ${sqlLiteral(activity.requiresScan)},
                ${sqlLiteral(activity.startsAt)});`);
    }
    for (const state of snapshot.activityStates) {
      statements.push(`INSERT INTO scanner_activity_states
        (user_id, activity_id, scan_count)
        VALUES (${sqlLiteral(state.userId)}, ${sqlLiteral(state.activityId)},
                ${sqlLiteral(state.count)});`);
    }
    statements.push(`INSERT INTO scanner_metadata (key, value)
      VALUES ('last_sync', ${sqlLiteral(snapshot.generatedAt)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
    await database.execAsync(statements.join("\n"));
  });
}

/**
 * Deletes the entire attendance roster cache (people, badges, activities,
 * scan counts) and retires its encryption key. Called on sign-out: the
 * roster is shared, event-wide data with no reason to survive a session
 * boundary, and a fresh snapshot rebuilds it in full on the next sign-in.
 */
export async function wipeAttendanceRoster(): Promise<void> {
  const database = await rosterDb();
  await withSerializedTransaction(rosterChainRef, database, async () => {
    await database.execAsync(`
      DELETE FROM scanner_people;
      DELETE FROM revoked_badges;
      DELETE FROM scanner_activities;
      DELETE FROM scanner_activity_states;
      DELETE FROM scanner_metadata;
    `);
  });
  await resetRosterKey();
}

function sqlLiteral(value: string | number | boolean | Date | null): string {
  if (value === null) return "NULL";
  if (value instanceof Date) return sqlLiteral(value.toISOString());
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("SQLite numbers must be finite");
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

type PersonRow = {
  user_id: number;
  ticket_token: string | null;
  badge_id: string | null;
  encrypted_payload: string;
};

async function personFromRow(row: PersonRow): Promise<ScannerPerson> {
  const key = await getRosterKey();
  const payload = await decryptJson<PersonPayload>(row.encrypted_payload, key);
  return {
    userId: row.user_id,
    ticketToken: row.ticket_token,
    badgeId: row.badge_id,
    revokedBadgeIds: [],
    ...payload,
  };
}

/** Re-encrypts and writes back one person's payload after a local mutation (badge rotation excluded — badge_id stays a plaintext column). */
async function updatePersonPayload(
  where: "ticket_token" | "user_id" | "badge_id",
  value: string | number,
  mutate: (payload: PersonPayload) => PersonPayload,
): Promise<void> {
  const database = await rosterDb();
  const key = await getRosterKey();
  await withSerializedTransaction(rosterChainRef, database, async () => {
    const row = await database.getFirstAsync<PersonRow>(
      `SELECT * FROM scanner_people WHERE ${where} = ?`,
      value,
    );
    if (!row) return;
    const payload = await decryptJson<PersonPayload>(row.encrypted_payload, key);
    const encrypted = await encryptJson(mutate(payload), key);
    await database.runAsync(
      `UPDATE scanner_people SET encrypted_payload = ? WHERE user_id = ?`,
      encrypted,
      row.user_id,
    );
  });
}

export async function findPersonByTicket(ticketToken: string): Promise<ScannerPerson | null> {
  const row = await (await rosterDb()).getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE ticket_token = ?`,
    ticketToken,
  );
  return row ? personFromRow(row) : null;
}

export async function findPersonById(userId: number): Promise<ScannerPerson | null> {
  const row = await (await rosterDb()).getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE user_id = ?`,
    userId,
  );
  return row ? personFromRow(row) : null;
}

/**
 * Names/emails/notes are encrypted at rest, so search can't be pushed down
 * into SQL — the (event-sized, not attendee-count-at-web-scale) roster is
 * decrypted once per call and filtered/sorted in JS instead.
 */
export async function listScannerPeople(query = ""): Promise<ScannerPerson[]> {
  const needle = query.trim().toLocaleLowerCase();
  const rows = await (await rosterDb()).getAllAsync<PersonRow>(`SELECT * FROM scanner_people`);
  const people = await Promise.all(rows.map(personFromRow));
  return people
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
  const database = await rosterDb();
  const row = await database.getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE badge_id = ?`,
    badgeId,
  );
  if (row) return { person: await personFromRow(row), revoked: false };
  const revoked = await database.getFirstAsync<{ badge_id: string }>(
    `SELECT badge_id FROM revoked_badges WHERE badge_id = ?`,
    badgeId,
  );
  if (revoked) return { person: null, revoked: true };
  return { person: null, revoked: false };
}

export async function listScannerActivities(): Promise<ScannerActivity[]> {
  const rows = await (await rosterDb()).getAllAsync<{
    id: number;
    name: string;
    category: string;
    requires_scan: number;
    starts_at: string | null;
  }>(`SELECT * FROM scanner_activities ORDER BY starts_at IS NULL, starts_at, name, id`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    requiresScan: row.requires_scan === 1,
    startsAt: row.starts_at,
  }));
}

export async function getActivityState(
  userId: number,
  activityId: number,
): Promise<ScannerActivityState> {
  const row = await (await rosterDb()).getFirstAsync<{
    scan_count: number;
  }>(
    `SELECT scan_count FROM scanner_activity_states
      WHERE user_id = ? AND activity_id = ?`,
    userId,
    activityId,
  );
  return {
    userId,
    activityId,
    count: row?.scan_count ?? 0,
  };
}

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Records a scan under the currently signed-in staff member's ownership.
 * The queue row is encrypted with that user's own key (scanner-crypto.ts),
 * so a different user signing in on this device later cannot decrypt or
 * even usefully list it — pendingScans() always filters by owner.
 */
export async function enqueueLocalScan(payload: ScanPayload, ownerUserId: number): Promise<string> {
  const database = await queueDb();
  const id = makeId();
  const now = new Date().toISOString();
  const key = await getQueueKey(ownerUserId);
  const encrypted = await encryptJson(payload, key);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `INSERT INTO pending_scans (id, kind, created_by_user_id, encrypted_payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      id,
      payload.kind,
      ownerUserId,
      encrypted,
      now,
    );
  });

  // Offline-safe local feedback against the roster. Accreditation is
  // intentionally excluded: it is never final locally and only becomes
  // assigned after server OK.
  if (payload.kind === "badge_rotation") {
    const roster = await rosterDb();
    await withSerializedTransaction(rosterChainRef, roster, async () => {
      await roster.runAsync(
        `INSERT OR IGNORE INTO revoked_badges (badge_id) VALUES (?)`,
        payload.currentBadgeId,
      );
      await roster.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
        payload.newBadgeId,
        payload.userId,
      );
    });
  } else if (payload.kind === "badge_removal") {
    const roster = await rosterDb();
    await withSerializedTransaction(rosterChainRef, roster, async () => {
      await roster.runAsync(
        `INSERT OR IGNORE INTO revoked_badges (badge_id) VALUES (?)`,
        payload.currentBadgeId,
      );
      await roster.runAsync(
        `UPDATE scanner_people SET badge_id = NULL WHERE user_id = ?`,
        payload.userId,
      );
    });
  } else if (payload.kind === "presence") {
    await updatePersonPayload("badge_id", payload.badgeId, (person) => ({
      ...person,
      lastPresenceKind: payload.direction,
      lastPresenceAt: payload.scannedAt,
    }));
  } else if (payload.kind === "activity") {
    const roster = await rosterDb();
    const owner = await roster.getFirstAsync<{ user_id: number }>(
      `SELECT user_id FROM scanner_people WHERE badge_id = ?`,
      payload.badgeId,
    );
    if (owner) {
      await roster.runAsync(
        `INSERT INTO scanner_activity_states (user_id, activity_id, scan_count)
         VALUES (?, ?, 1)
         ON CONFLICT(user_id, activity_id)
         DO UPDATE SET scan_count = scan_count + 1`,
        owner.user_id,
        payload.activityId,
      );
    }
  }
  return id;
}

type PendingScanRow = {
  id: string;
  kind: PendingScan["kind"];
  created_by_user_id: number;
  encrypted_payload: string;
  status: PendingScan["status"];
  attempts: number;
  last_error: string | null;
  created_at: string;
  acknowledged_at: string | null;
  clock_corrected: number;
};

async function pendingScanFromRow(row: PendingScanRow): Promise<PendingScan> {
  const key = await getQueueKey(row.created_by_user_id);
  const payload = await decryptJson<ScanPayload>(row.encrypted_payload, key);
  return {
    id: row.id,
    kind: row.kind,
    payload,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    clockCorrected: row.clock_corrected === 1,
  };
}

/**
 * Always scoped to a single owner: the currently signed-in staff member.
 * A previous user's still-unsynced scans stay in this same table (and are
 * not deleted on their sign-out) but are invisible to anyone else who signs
 * in on this device — they reappear, decryptable again, once that same
 * user signs back in.
 */
export async function pendingScans(
  ownerUserId: number,
  onlyPending = false,
): Promise<PendingScan[]> {
  const where = onlyPending
    ? `WHERE created_by_user_id = ? AND status = 'pending'`
    : `WHERE created_by_user_id = ?`;
  const rows = await (await queueDb()).getAllAsync<PendingScanRow>(
    `SELECT * FROM pending_scans ${where} ORDER BY created_at ASC`,
    ownerUserId,
  );
  return Promise.all(rows.map(pendingScanFromRow));
}

export async function markScanAttempt(id: string): Promise<void> {
  await (await queueDb()).runAsync(
    `UPDATE pending_scans SET attempts = attempts + 1, last_error = NULL WHERE id = ?`,
    id,
  );
}

export async function acknowledgeScan(id: string, payload: ScanPayload): Promise<void> {
  const database = await queueDb();
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `UPDATE pending_scans SET status = 'acknowledged', acknowledged_at = ?, last_error = NULL
        WHERE id = ?`,
      new Date().toISOString(),
      id,
    );
  });
  if (payload.kind === "accreditation") {
    await (await rosterDb()).runAsync(
      `UPDATE scanner_people SET badge_id = ? WHERE ticket_token = ?`,
      payload.badgeId,
      payload.ticketToken,
    );
  } else if (payload.kind === "accreditation_user") {
    await (await rosterDb()).runAsync(
      `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
      payload.badgeId,
      payload.userId,
    );
  }
}

export async function failScan(id: string, message: string): Promise<void> {
  await (await queueDb()).runAsync(
    `UPDATE pending_scans SET status = 'failed', last_error = ? WHERE id = ?`,
    message,
    id,
  );
}

export async function noteRetryableError(id: string, message: string): Promise<void> {
  await (await queueDb()).runAsync(
    `UPDATE pending_scans SET last_error = ? WHERE id = ?`,
    message,
    id,
  );
}

/**
 * Applies a device-clock-skew correction to a scan's stored payload (only
 * ever done once per scan, see scanner-sync.ts) rather than discarding the
 * originally logged time — the correction shifts it by the measured skew
 * instead of replacing it with "now". Re-encrypted with the scan's own
 * owner's key.
 */
export async function correctScanTimestamp(
  id: string,
  ownerUserId: number,
  payload: ScanPayload,
): Promise<void> {
  const key = await getQueueKey(ownerUserId);
  const encrypted = await encryptJson(payload, key);
  await (await queueDb()).runAsync(
    `UPDATE pending_scans SET encrypted_payload = ?, clock_corrected = 1, last_error = NULL WHERE id = ?`,
    encrypted,
    id,
  );
}

export async function retryFailedScans(ownerUserId: number): Promise<void> {
  await (await queueDb()).runAsync(
    `UPDATE pending_scans SET status = 'pending', last_error = NULL
      WHERE status = 'failed' AND created_by_user_id = ?`,
    ownerUserId,
  );
}

/**
 * Discards a scan the operator has decided to give up on (e.g. after logging
 * it manually in the web admin panel instead). Only ever invoked by an
 * explicit operator action — never called automatically, since a queued
 * scan is the only record of that transaction until it's acknowledged.
 */
export async function deleteScan(id: string): Promise<void> {
  await (await queueDb()).runAsync(`DELETE FROM pending_scans WHERE id = ?`, id);
}

export async function getScannerMeta(
  ownerUserId: number,
): Promise<{ lastSync: string | null; pending: number }> {
  const sync = await (await rosterDb()).getFirstAsync<{ value: string }>(
    `SELECT value FROM scanner_metadata WHERE key = 'last_sync'`,
  );
  const pending = await (await queueDb()).getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM pending_scans WHERE status = 'pending' AND created_by_user_id = ?`,
    ownerUserId,
  );
  return { lastSync: sync?.value ?? null, pending: pending?.count ?? 0 };
}
