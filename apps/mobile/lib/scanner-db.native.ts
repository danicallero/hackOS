import { type Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import {
  decryptJson,
  encryptJson,
  getQueueKey,
  getRosterKey,
  resetQueueKey,
  resetRosterKey,
} from "./scanner-crypto";
import { revokedBadgesFromSnapshot } from "./scanner-model";
import type {
  PendingScan,
  ScannerActivity,
  ScannerActivityState,
  ScannerPerson,
  ScannerSnapshot,
  ScannerSyncErrorEntry,
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

const ROSTER_DATABASE_NAME = "hackos-scanner-roster.db";
const QUEUE_DATABASE_NAME = "hackos-scanner-queue.db";
const LEGACY_DATABASE_NAME = "hackos-scanner.db";
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

let rosterDatabase: Promise<SQLite.SQLiteDatabase> | null = null;
let queueDatabase: Promise<SQLite.SQLiteDatabase> | null = null;
let legacyQueueMigration: Promise<void> | null = null;
// The roster is shared by all staff accounts on a device, but its contents
// are session-bound. A late snapshot from account A must not replace the
// wiped/new account B roster after sign-out or an account switch (H54/C6).
let rosterGeneration = 0;
let rosterOwnerUserId: number | null = null;

interface PersonPayload {
  email: string;
  role: ScannerPerson["role"];
  hasCapabilities: boolean;
  isEnterpriseJudge: boolean;
  eventAccess: boolean;
  name: string | null;
  surname: string | null;
  dni: string | null;
  accepted: boolean;
  confirmed: boolean;
  intolerances: ScannerPerson["intolerances"];
  foodIntoleranceNotes: string | null;
  notes: string | null;
  lastPresenceKind: "in" | "out" | null;
  lastPresenceAt: string | null;
}

/**
 * One-time upgrade path for a roster db opened before H50's translation
 * columns existed: `CREATE TABLE IF NOT EXISTS` is a no-op on an
 * already-existing table, so a device that synced before this change keeps
 * its old 5-column `scanner_activities` shape until explicitly widened here.
 * Safe to call on every open — checked against `PRAGMA table_info` first.
 */
async function addScannerActivityI18nColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = new Set(
    (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(scanner_activities)`)).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("primary_language")) {
    await db.execAsync(
      "ALTER TABLE scanner_activities ADD COLUMN primary_language TEXT NOT NULL DEFAULT 'es'",
    );
  }
  if (!columns.has("name_i18n")) {
    await db.execAsync(
      "ALTER TABLE scanner_activities ADD COLUMN name_i18n TEXT NOT NULL DEFAULT '{}'",
    );
  }
  if (!columns.has("description_i18n")) {
    await db.execAsync(
      "ALTER TABLE scanner_activities ADD COLUMN description_i18n TEXT NOT NULL DEFAULT '{}'",
    );
  }
}

async function tableColumns(db: SQLite.SQLiteDatabase, table: string): Promise<Set<string>> {
  return new Set(
    (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map(
      (column) => column.name,
    ),
  );
}

function hasExactColumns(actual: Set<string>, expected: readonly string[]): boolean {
  return actual.size === expected.length && expected.every((column) => actual.has(column));
}

function sqliteSidecarFiles(directory: Directory, databaseName: string): File[] {
  return SQLITE_SIDECAR_SUFFIXES.map((suffix) => new File(directory, `${databaseName}${suffix}`));
}

function removeSqliteSidecars(directory: Directory, databaseName: string): void {
  for (const sidecar of sqliteSidecarFiles(directory, databaseName)) {
    if (sidecar.exists) sidecar.delete();
  }
}

async function prepareRosterDatabase(db: SQLite.SQLiteDatabase): Promise<boolean> {
  await db.execAsync(`
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
    CREATE TABLE IF NOT EXISTS revoked_tickets (ticket_token TEXT PRIMARY KEY);
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
  await addScannerActivityI18nColumns(db);

  return (
    hasExactColumns(await tableColumns(db, "scanner_people"), [
      "user_id",
      "ticket_token",
      "badge_id",
      "encrypted_payload",
    ]) &&
    hasExactColumns(await tableColumns(db, "revoked_badges"), ["badge_id"]) &&
    hasExactColumns(await tableColumns(db, "revoked_tickets"), ["ticket_token"]) &&
    hasExactColumns(await tableColumns(db, "scanner_activities"), [
      "id",
      "name",
      "category",
      "requires_scan",
      "starts_at",
      "primary_language",
      "name_i18n",
      "description_i18n",
    ]) &&
    hasExactColumns(await tableColumns(db, "scanner_activity_states"), [
      "user_id",
      "activity_id",
      "scan_count",
    ]) &&
    hasExactColumns(await tableColumns(db, "scanner_metadata"), ["key", "value"])
  );
}

async function openRosterDatabase(): Promise<SQLite.SQLiteDatabase> {
  let opened = await SQLite.openDatabaseAsync(ROSTER_DATABASE_NAME, undefined, Paths.cache.uri);
  try {
    if (await prepareRosterDatabase(opened)) return opened;

    // The roster is disposable cache data. A database with the old plaintext
    // shape, a partial migration, or any unknown extra NOT NULL column cannot
    // be made safe by ALTER TABLE; discard only this cache file and rebuild it
    // from the next server snapshot.
    await opened.closeAsync();
    await SQLite.deleteDatabaseAsync(ROSTER_DATABASE_NAME, Paths.cache.uri);
    removeSqliteSidecars(Paths.cache, ROSTER_DATABASE_NAME);
    opened = await SQLite.openDatabaseAsync(ROSTER_DATABASE_NAME, undefined, Paths.cache.uri);
    if (!(await prepareRosterDatabase(opened))) {
      throw new Error("Unable to initialize the encrypted scanner roster");
    }
    return opened;
  } catch (error) {
    await opened.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function rosterDb(): Promise<SQLite.SQLiteDatabase> {
  if (!rosterDatabase) {
    rosterDatabase = openRosterDatabase().catch((error) => {
      rosterDatabase = null;
      throw error;
    });
  }
  return rosterDatabase;
}

async function openQueueDatabase(): Promise<SQLite.SQLiteDatabase> {
  const opened = await SQLite.openDatabaseAsync(QUEUE_DATABASE_NAME);
  try {
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
      CREATE TABLE IF NOT EXISTS scanner_sync_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        created_by_user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        error_type TEXT NOT NULL,
        message TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scanner_sync_errors_owner_time
        ON scanner_sync_errors(created_by_user_id, occurred_at, id);
    `);

    // Never reinterpret a legacy/plaintext queue as encrypted data. The old
    // combined database is retired separately below, while a malformed current
    // queue remains untouched so an operator can recover it rather than losing
    // the only copy of an offline transaction.
    if (
      !hasExactColumns(await tableColumns(opened, "pending_scans"), [
        "id",
        "kind",
        "created_by_user_id",
        "encrypted_payload",
        "status",
        "attempts",
        "last_error",
        "created_at",
        "acknowledged_at",
        "clock_corrected",
      ]) ||
      !hasExactColumns(await tableColumns(opened, "scanner_sync_errors"), [
        "id",
        "scan_id",
        "created_by_user_id",
        "kind",
        "error_type",
        "message",
        "occurred_at",
      ])
    ) {
      throw new Error("Incompatible encrypted scanner queue database");
    }
    return opened;
  } catch (error) {
    await opened.closeAsync().catch(() => undefined);
    throw error;
  }
}

async function queueDb(ownerUserId?: number): Promise<SQLite.SQLiteDatabase> {
  if (!queueDatabase) {
    queueDatabase = openQueueDatabase().catch((error) => {
      queueDatabase = null;
      throw error;
    });
  }
  const database = await queueDatabase;
  if (ownerUserId !== undefined && legacyQueueMigration === null) {
    legacyQueueMigration = retireLegacyScannerDatabase().catch((error) => {
      // Keep the migration retryable if the OS refuses to remove the legacy
      // identity-bearing file. Until it succeeds, the current queue is not
      // used, so no stale payload can be replayed or assigned to this owner.
      legacyQueueMigration = null;
      throw error;
    });
  }
  if (legacyQueueMigration) await legacyQueueMigration;
  return database;
}

/**
 * Retire the pre-H54 combined scanner database.
 *
 * That file contained an identity-bearing roster and plaintext pending scan
 * payloads without an owner column. There is no trustworthy way to determine
 * which staff account created an old row, so importing it into the current
 * per-owner queue would be an attribution and privacy bug. The old filename
 * is app-owned and is no longer read by any current scanner path; delete the
 * database and all SQLite journal sidecars before the new queue is used.
 *
 * This is deliberately a breaking local migration: offline scans left only
 * in the old file must be recorded again after the app upgrade. If the OS
 * refuses deletion, reject queue initialization and retry on the next
 * authenticated call rather than exposing or replaying the legacy data.
 */
async function retireLegacyScannerDatabase(): Promise<void> {
  const legacyFile = new File(Paths.document, "SQLite", LEGACY_DATABASE_NAME);
  const sidecarFiles = sqliteSidecarFiles(Paths.document, LEGACY_DATABASE_NAME);

  // Do not open the legacy name on a fresh install: openDatabaseAsync creates
  // a new file, which made the migration itself fail on Android and blocked
  // every encrypted queue operation before the first scan.
  if (!legacyFile.exists && !sidecarFiles.some((file) => file.exists)) return;

  let legacy: SQLite.SQLiteDatabase | null = null;
  if (legacyFile.exists) {
    try {
      legacy = await SQLite.openDatabaseAsync(LEGACY_DATABASE_NAME);
    } catch {
      // A corrupt legacy file still contains untrusted identity-bearing data;
      // it is retired without reading or importing any row.
    } finally {
      if (legacy) {
        await legacy.closeAsync();
      }
    }
  }

  if (legacyFile.exists) await SQLite.deleteDatabaseAsync(LEGACY_DATABASE_NAME);
  for (const sidecar of sidecarFiles) {
    if (sidecar.exists) sidecar.delete();
  }

  if (legacyFile.exists || sidecarFiles.some((file) => file.exists)) {
    throw new Error("Unable to retire the legacy scanner database");
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

// Reads must use the same queue as writes. Expo SQLite's async methods share
// the connection with `withTransactionAsync`; an unqueued SELECT can suspend
// a replace-all snapshot halfway through its transaction on Android.
function withSerializedRosterOperation<T>(
  work: (database: SQLite.SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const run = rosterChainRef.chain.then(async () => work(await rosterDb()));
  rosterChainRef.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function applyScannerSnapshot(
  snapshot: ScannerSnapshot,
  ownerUserId?: number,
): Promise<void> {
  const generation =
    ownerUserId !== undefined && rosterOwnerUserId !== ownerUserId
      ? ++rosterGeneration
      : rosterGeneration;
  if (ownerUserId !== undefined) rosterOwnerUserId = ownerUserId;
  // Better Fetch can revive ISO timestamps as Date instances on native
  // clients, even though the wire schema is typed as a string. SQLite only
  // needs the canonical text form, so normalize both runtime shapes before
  // the NOT NULL metadata write.
  const rawGeneratedAt: unknown = snapshot.generatedAt;
  const generatedAt =
    typeof rawGeneratedAt === "string"
      ? rawGeneratedAt
      : rawGeneratedAt instanceof Date && !Number.isNaN(rawGeneratedAt.getTime())
        ? rawGeneratedAt.toISOString()
        : null;
  if (!generatedAt) throw new Error("Scanner snapshot is missing generatedAt");
  const database = await rosterDb();
  const key = await getRosterKey();
  // expo-crypto's Android bridge does not reliably complete several AES
  // operations issued at once. The roster is event-sized, so serialize the
  // small encryption batch before opening the SQLite transaction instead of
  // leaving a successful server snapshot hanging forever.
  const encryptedPeople: Array<{ person: ScannerPerson; encrypted: string }> = [];
  for (const person of snapshot.people) {
    encryptedPeople.push({
      person,
      encrypted: await encryptJson(
        {
          email: person.email ?? "",
          role: person.role,
          hasCapabilities: person.hasCapabilities,
          isEnterpriseJudge: person.isEnterpriseJudge,
          eventAccess: person.eventAccess,
          name: person.name,
          surname: person.surname,
          dni: person.dni,
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
    });
  }
  await withSerializedTransaction(rosterChainRef, database, async () => {
    // Sign-out/wipe and a newer owner's snapshot advance the generation before
    // their database transaction is queued. Do not let this stale operation
    // clear or repopulate the roster when it finally reaches SQLite.
    if (
      generation !== rosterGeneration ||
      (ownerUserId !== undefined && rosterOwnerUserId !== ownerUserId)
    ) {
      return;
    }
    await database.runAsync("DELETE FROM scanner_people");
    await database.runAsync("DELETE FROM revoked_badges");
    await database.runAsync("DELETE FROM revoked_tickets");
    await database.runAsync("DELETE FROM scanner_activities");
    await database.runAsync("DELETE FROM scanner_activity_states");
    for (const { person, encrypted } of encryptedPeople) {
      await database.runAsync(
        `INSERT INTO scanner_people
          (user_id, ticket_token, badge_id, encrypted_payload)
         VALUES (?, ?, ?, ?)`,
        person.userId,
        person.ticketToken,
        person.badgeId,
        encrypted,
      );
    }
    for (const revoked of revokedBadgesFromSnapshot(snapshot)) {
      await database.runAsync(`INSERT INTO revoked_badges (badge_id) VALUES (?)`, revoked);
    }
    for (const revoked of snapshot.revokedTicketTokens ?? []) {
      await database.runAsync(`INSERT INTO revoked_tickets (ticket_token) VALUES (?)`, revoked);
    }
    for (const activity of snapshot.activities) {
      await database.runAsync(
        `INSERT INTO scanner_activities
        (id, name, category, requires_scan, starts_at, primary_language, name_i18n, description_i18n)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        activity.id,
        activity.name,
        activity.category,
        activity.requiresScan ? 1 : 0,
        activity.startsAt,
        activity.primaryLanguage,
        JSON.stringify(activity.nameI18n),
        JSON.stringify(activity.descriptionI18n),
      );
    }
    for (const state of snapshot.activityStates) {
      await database.runAsync(
        `INSERT INTO scanner_activity_states
        (user_id, activity_id, scan_count)
        VALUES (?, ?, ?)`,
        state.userId,
        state.activityId,
        state.count,
      );
    }
    await database.runAsync(
      `INSERT INTO scanner_metadata (key, value)
        VALUES ('last_sync', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      generatedAt,
    );
  });
}

/**
 * Deletes the entire attendance roster cache (people, badges, activities,
 * scan counts) and retires its encryption key. Called on sign-out: the
 * roster is shared, event-wide data with no reason to survive a session
 * boundary, and a fresh snapshot rebuilds it in full on the next sign-in.
 */
export async function wipeAttendanceRoster(ownerUserId?: number): Promise<void> {
  // If a newer session has already installed its owner fence, an older
  // sign-out must not wipe that session's roster. This matters when the auth
  // transition and SQLite cleanup resolve in opposite orders.
  if (
    ownerUserId !== undefined &&
    rosterOwnerUserId !== null &&
    rosterOwnerUserId !== ownerUserId
  ) {
    return;
  }
  const targetOwner = ownerUserId ?? rosterOwnerUserId;
  // Advance the fence before awaiting database/key operations so an already
  // started snapshot cannot commit after this session boundary.
  const generation = ++rosterGeneration;
  rosterOwnerUserId = null;
  const database = await rosterDb();
  await withSerializedTransaction(rosterChainRef, database, async () => {
    if (
      generation !== rosterGeneration ||
      (targetOwner !== null && rosterOwnerUserId !== null && rosterOwnerUserId !== targetOwner)
    ) {
      return;
    }
    await database.execAsync(`
      DELETE FROM scanner_people;
      DELETE FROM revoked_badges;
      DELETE FROM revoked_tickets;
      DELETE FROM scanner_activities;
      DELETE FROM scanner_activity_states;
      DELETE FROM scanner_metadata;
    `);
  });
  if (generation === rosterGeneration && rosterOwnerUserId === null) await resetRosterKey();
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
    // A roster encrypted before event-access was added is safe to treat as
    // not entitled until the next server snapshot replaces it.
    eventAccess: payload.eventAccess ?? false,
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
  const row = await withSerializedRosterOperation(async (database) => {
    const revoked = await database.getFirstAsync<{ ticket_token: string }>(
      `SELECT ticket_token FROM revoked_tickets WHERE ticket_token = ?`,
      ticketToken,
    );
    if (revoked) return null;
    return database.getFirstAsync<PersonRow>(
      `SELECT * FROM scanner_people WHERE ticket_token = ?`,
      ticketToken,
    );
  });
  return row ? personFromRow(row) : null;
}

export async function findPersonById(userId: number): Promise<ScannerPerson | null> {
  const row = await withSerializedRosterOperation((database) =>
    database.getFirstAsync<PersonRow>(`SELECT * FROM scanner_people WHERE user_id = ?`, userId),
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
  const rows = await withSerializedRosterOperation((database) =>
    database.getAllAsync<PersonRow>(`SELECT * FROM scanner_people`),
  );
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
  const result = await withSerializedRosterOperation(async (database) => {
    const revoked = await database.getFirstAsync<{ badge_id: string }>(
      `SELECT badge_id FROM revoked_badges WHERE badge_id = ?`,
      badgeId,
    );
    if (revoked) return { row: null, revoked: true };
    return {
      row: await database.getFirstAsync<PersonRow>(
        `SELECT * FROM scanner_people WHERE badge_id = ?`,
        badgeId,
      ),
      revoked: false,
    };
  });
  return {
    person: result.row ? await personFromRow(result.row) : null,
    revoked: result.revoked,
  };
}

export async function listScannerActivities(): Promise<ScannerActivity[]> {
  const rows = await withSerializedRosterOperation((database) =>
    database.getAllAsync<{
      id: number;
      name: string;
      category: string;
      requires_scan: number;
      starts_at: string | null;
      primary_language: ScannerActivity["primaryLanguage"];
      name_i18n: string;
      description_i18n: string;
    }>(`SELECT * FROM scanner_activities ORDER BY starts_at IS NULL, starts_at, name, id`),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    requiresScan: row.requires_scan === 1,
    startsAt: row.starts_at,
    primaryLanguage: row.primary_language,
    nameI18n: JSON.parse(row.name_i18n),
    descriptionI18n: JSON.parse(row.description_i18n),
  }));
}

export async function getActivityState(
  userId: number,
  activityId: number,
): Promise<ScannerActivityState> {
  const row = await withSerializedRosterOperation((database) =>
    database.getFirstAsync<{ scan_count: number }>(
      `SELECT scan_count FROM scanner_activity_states
        WHERE user_id = ? AND activity_id = ?`,
      userId,
      activityId,
    ),
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
export async function enqueueLocalScan(
  payload: ScanPayload,
  ownerUserId: number,
  idOverride?: string,
): Promise<string> {
  const database = await queueDb(ownerUserId);
  const id = idOverride ?? makeId();
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
    await revokeBadgeAndSetLocal(payload.currentBadgeId, payload.userId, payload.newBadgeId);
  } else if (payload.kind === "badge_removal") {
    await revokeBadgeAndSetLocal(payload.currentBadgeId, payload.userId, null);
  } else if (payload.kind === "presence") {
    await updatePersonPayload("badge_id", payload.badgeId, (person) => ({
      ...person,
      lastPresenceKind: payload.direction,
      lastPresenceAt: payload.scannedAt,
    }));
  } else if (payload.kind === "activity") {
    const roster = await rosterDb();
    await withSerializedTransaction(rosterChainRef, roster, async () => {
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
    });
  }
  return id;
}

/**
 * Shared local-roster effect of badge_rotation (newBadgeId set) and
 * badge_removal (newBadgeId null): the old badge is revoked immediately so a
 * still-offline scanner on another device rejects it before the mutation
 * ever reaches the server.
 */
async function revokeBadgeAndSetLocal(
  oldBadgeId: string,
  userId: number,
  newBadgeId: string | null,
): Promise<void> {
  const roster = await rosterDb();
  await withSerializedTransaction(rosterChainRef, roster, async () => {
    await roster.runAsync(`INSERT OR IGNORE INTO revoked_badges (badge_id) VALUES (?)`, oldBadgeId);
    await roster.runAsync(
      `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
      newBadgeId,
      userId,
    );
  });
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
  const rows = await (await queueDb(ownerUserId)).getAllAsync<PendingScanRow>(
    `SELECT * FROM pending_scans ${where} ORDER BY created_at ASC`,
    ownerUserId,
  );
  return Promise.all(rows.map(pendingScanFromRow));
}

export async function markScanAttempt(id: string, ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `UPDATE pending_scans SET attempts = attempts + 1, last_error = NULL
        WHERE id = ? AND created_by_user_id = ?`,
      id,
      ownerUserId,
    );
  });
}

export async function acknowledgeScan(
  id: string,
  payload: ScanPayload,
  ownerUserId: number,
): Promise<void> {
  const database = await queueDb(ownerUserId);
  let acknowledged = false;
  await withSerializedTransaction(queueChainRef, database, async () => {
    const result = await database.runAsync(
      `UPDATE pending_scans SET status = 'acknowledged', acknowledged_at = ?, last_error = NULL
        WHERE id = ? AND created_by_user_id = ?`,
      new Date().toISOString(),
      id,
      ownerUserId,
    );
    acknowledged = result.changes > 0;
  });
  if (!acknowledged) return;
  if (payload.kind === "accreditation") {
    const roster = await rosterDb();
    await withSerializedTransaction(rosterChainRef, roster, async () => {
      await roster.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE ticket_token = ?`,
        payload.badgeId,
        payload.ticketToken,
      );
    });
  } else if (payload.kind === "accreditation_user") {
    const roster = await rosterDb();
    await withSerializedTransaction(rosterChainRef, roster, async () => {
      await roster.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
        payload.badgeId,
        payload.userId,
      );
    });
  }
}

export async function failScan(id: string, message: string, ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    const result = await database.runAsync(
      `UPDATE pending_scans SET status = 'failed', last_error = ?
        WHERE id = ? AND created_by_user_id = ?
          AND (last_error IS NULL OR last_error <> ? OR status <> 'failed')`,
      message,
      id,
      ownerUserId,
      message,
    );
    if (result.changes === 0) return;
    await database.runAsync(
      `INSERT INTO scanner_sync_errors
        (scan_id, created_by_user_id, kind, error_type, message, occurred_at)
       SELECT id, created_by_user_id, kind, 'rejected', ?, ?
         FROM pending_scans
        WHERE id = ? AND created_by_user_id = ?`,
      message,
      new Date().toISOString(),
      id,
      ownerUserId,
    );
  });
}

export async function noteRetryableError(
  id: string,
  message: string,
  ownerUserId: number,
): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    const result = await database.runAsync(
      `UPDATE pending_scans SET last_error = ?
        WHERE id = ? AND created_by_user_id = ?
          AND (last_error IS NULL OR last_error <> ?)`,
      message,
      id,
      ownerUserId,
      message,
    );
    if (result.changes === 0) return;
    await database.runAsync(
      `INSERT INTO scanner_sync_errors
        (scan_id, created_by_user_id, kind, error_type, message, occurred_at)
       SELECT id, created_by_user_id, kind, 'retryable', ?, ?
         FROM pending_scans
        WHERE id = ? AND created_by_user_id = ?`,
      message,
      new Date().toISOString(),
      id,
      ownerUserId,
    );
  });
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
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `UPDATE pending_scans SET encrypted_payload = ?, clock_corrected = 1, last_error = NULL
        WHERE id = ? AND created_by_user_id = ?`,
      encrypted,
      id,
      ownerUserId,
    );
  });
}

export async function retryFailedScans(ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `UPDATE pending_scans SET status = 'pending', last_error = NULL
        WHERE status = 'failed' AND created_by_user_id = ?`,
      ownerUserId,
    );
  });
}

/** Same as retryFailedScans, scoped to a single scan the operator picked from the queue. */
export async function retryScan(id: string, ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `UPDATE pending_scans SET status = 'pending', last_error = NULL
        WHERE id = ? AND status = 'failed' AND created_by_user_id = ?`,
      id,
      ownerUserId,
    );
  });
}

/**
 * Discards a scan the operator has decided to give up on (e.g. after logging
 * it manually in the web admin panel instead). Only ever invoked by an
 * explicit operator action — never called automatically, since a queued
 * scan is the only record of that transaction until it's acknowledged.
 */
export async function deleteScan(id: string, ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(
      `DELETE FROM pending_scans WHERE id = ? AND created_by_user_id = ?`,
      id,
      ownerUserId,
    );
  });
}

/** H54: remove every encrypted offline scan owned by an account being closed. */
export async function wipeOfflineScanQueue(ownerUserId: number): Promise<void> {
  const database = await queueDb(ownerUserId);
  await withSerializedTransaction(queueChainRef, database, async () => {
    await database.runAsync(`DELETE FROM pending_scans WHERE created_by_user_id = ?`, ownerUserId);
    await database.runAsync(
      `DELETE FROM scanner_sync_errors WHERE created_by_user_id = ?`,
      ownerUserId,
    );
  });
  await resetQueueKey(ownerUserId);
}

/** Returns every replay error for this operator, newest first. */
export async function syncErrorHistory(ownerUserId: number): Promise<ScannerSyncErrorEntry[]> {
  const rows = await (await queueDb(ownerUserId)).getAllAsync<{
    id: number;
    scan_id: string;
    kind: ScannerSyncErrorEntry["kind"];
    error_type: ScannerSyncErrorEntry["type"];
    message: string;
    occurred_at: string;
  }>(
    `SELECT id, scan_id, kind, error_type, message, occurred_at
       FROM scanner_sync_errors
      WHERE created_by_user_id = ?
      ORDER BY occurred_at DESC, id DESC`,
    ownerUserId,
  );
  return rows.map((row) => ({
    id: row.id,
    scanId: row.scan_id,
    kind: row.kind,
    type: row.error_type,
    message: row.message,
    occurredAt: row.occurred_at,
  }));
}

export async function getScannerMeta(
  ownerUserId: number,
): Promise<{ lastSync: string | null; pending: number }> {
  const sync = await withSerializedRosterOperation((database) =>
    database.getFirstAsync<{ value: string }>(
      `SELECT value FROM scanner_metadata WHERE key = 'last_sync'`,
    ),
  );
  const pending = await (await queueDb(ownerUserId)).getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM pending_scans WHERE status = 'pending' AND created_by_user_id = ?`,
    ownerUserId,
  );
  return { lastSync: sync?.value ?? null, pending: pending?.count ?? 0 };
}
