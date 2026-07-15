import * as SQLite from "expo-sqlite";
import { revokedBadgesFromSnapshot } from "./scanner-model";
import type {
  PendingScan,
  ScannerActivity,
  ScannerActivityState,
  ScannerPerson,
  ScannerSnapshot,
  ScanPayload,
} from "./scanner-types";

let database: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!database) {
    database = SQLite.openDatabaseAsync("hackos-scanner.db").then(async (opened) => {
      await opened.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS scanner_people (
          user_id INTEGER PRIMARY KEY,
          email TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'participant',
          ticket_token TEXT UNIQUE,
          badge_id TEXT UNIQUE,
          name TEXT,
          surname TEXT,
          accepted INTEGER NOT NULL DEFAULT 0,
          confirmed INTEGER NOT NULL,
          intolerances_json TEXT NOT NULL,
          food_intolerance_notes TEXT,
          notes TEXT,
          last_presence_kind TEXT,
          last_presence_at TEXT
        );
        CREATE TABLE IF NOT EXISTS revoked_badges (badge_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS scanner_activities (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          requires_scan INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scanner_activity_states (
          user_id INTEGER NOT NULL,
          activity_id INTEGER NOT NULL,
          scan_count INTEGER NOT NULL,
          entitled INTEGER NOT NULL,
          PRIMARY KEY (user_id, activity_id)
        );
        CREATE TABLE IF NOT EXISTS pending_scans (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at TEXT NOT NULL,
          acknowledged_at TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_scans_status ON pending_scans(status, created_at);
        CREATE TABLE IF NOT EXISTS scanner_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      const personColumns = new Set(
        (await opened.getAllAsync<{ name: string }>("PRAGMA table_info(scanner_people)")).map(
          (column) => column.name,
        ),
      );
      if (!personColumns.has("email"))
        await opened.execAsync(
          "ALTER TABLE scanner_people ADD COLUMN email TEXT NOT NULL DEFAULT ''",
        );
      if (!personColumns.has("role"))
        await opened.execAsync(
          "ALTER TABLE scanner_people ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'",
        );
      if (!personColumns.has("accepted"))
        await opened.execAsync(
          "ALTER TABLE scanner_people ADD COLUMN accepted INTEGER NOT NULL DEFAULT 0",
        );
      return opened;
    });
  }
  return database;
}

export async function applyScannerSnapshot(snapshot: ScannerSnapshot): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    const statements = [
      `
      DELETE FROM scanner_people;
      DELETE FROM revoked_badges;
      DELETE FROM scanner_activities;
      DELETE FROM scanner_activity_states;
    `,
    ];
    for (const person of snapshot.people) {
      statements.push(`INSERT INTO scanner_people
          (user_id, email, role, ticket_token, badge_id, name, surname, accepted, confirmed, intolerances_json,
           food_intolerance_notes, notes, last_presence_kind, last_presence_at)
         VALUES (${sqlLiteral(person.userId)}, ${sqlLiteral(person.email ?? "")}, ${sqlLiteral(person.role ?? "participant")},
                 ${sqlLiteral(person.ticketToken)},
                 ${sqlLiteral(person.badgeId)}, ${sqlLiteral(person.name)},
                 ${sqlLiteral(person.surname)}, ${sqlLiteral(person.accepted ?? person.confirmed)},
                 ${sqlLiteral(person.confirmed)},
                 ${sqlLiteral(JSON.stringify(person.intolerances))},
                 ${sqlLiteral(person.foodIntoleranceNotes)}, ${sqlLiteral(person.notes)},
                 ${sqlLiteral(person.lastPresenceKind)}, ${sqlLiteral(person.lastPresenceAt)});`);
    }
    for (const revoked of revokedBadgesFromSnapshot(snapshot)) {
      statements.push(`INSERT INTO revoked_badges (badge_id) VALUES (${sqlLiteral(revoked)});`);
    }
    for (const activity of snapshot.activities) {
      statements.push(`INSERT INTO scanner_activities (id, name, category, requires_scan)
        VALUES (${sqlLiteral(activity.id)}, ${sqlLiteral(activity.name)},
                ${sqlLiteral(activity.category)}, ${sqlLiteral(activity.requiresScan)});`);
    }
    for (const state of snapshot.activityStates) {
      statements.push(`INSERT INTO scanner_activity_states
        (user_id, activity_id, scan_count, entitled)
        VALUES (${sqlLiteral(state.userId)}, ${sqlLiteral(state.activityId)},
                ${sqlLiteral(state.count)}, ${sqlLiteral(state.entitled)});`);
    }
    statements.push(`INSERT INTO scanner_metadata (key, value)
      VALUES ('last_sync', ${sqlLiteral(snapshot.generatedAt)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
    await database.execAsync(statements.join("\n"));
  });
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
  email: string;
  role: ScannerPerson["role"];
  ticket_token: string | null;
  badge_id: string | null;
  name: string | null;
  surname: string | null;
  accepted: number;
  confirmed: number;
  intolerances_json: string;
  food_intolerance_notes: string | null;
  notes: string | null;
  last_presence_kind: "in" | "out" | null;
  last_presence_at: string | null;
};

function personFromRow(row: PersonRow): ScannerPerson {
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role,
    ticketToken: row.ticket_token,
    badgeId: row.badge_id,
    revokedBadgeIds: [],
    name: row.name,
    surname: row.surname,
    accepted: row.accepted === 1,
    confirmed: row.confirmed === 1,
    intolerances: JSON.parse(row.intolerances_json),
    foodIntoleranceNotes: row.food_intolerance_notes,
    notes: row.notes,
    lastPresenceKind: row.last_presence_kind,
    lastPresenceAt: row.last_presence_at,
  };
}

export async function findPersonByTicket(ticketToken: string): Promise<ScannerPerson | null> {
  const row = await (await db()).getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE ticket_token = ?`,
    ticketToken,
  );
  return row ? personFromRow(row) : null;
}

export async function findPersonById(userId: number): Promise<ScannerPerson | null> {
  const row = await (await db()).getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE user_id = ?`,
    userId,
  );
  return row ? personFromRow(row) : null;
}

export async function listScannerPeople(query = ""): Promise<ScannerPerson[]> {
  const needle = query.trim().toLocaleLowerCase();
  const rows = await (await db()).getAllAsync<PersonRow>(
    needle
      ? `SELECT * FROM scanner_people
          WHERE lower(coalesce(name, '') || ' ' || coalesce(surname, '') || ' ' || email || ' ' || coalesce(badge_id, '')) LIKE ?
          ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE, user_id`
      : `SELECT * FROM scanner_people
          ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE, user_id`,
    ...(needle ? [`%${needle}%`] : []),
  );
  return rows.map(personFromRow);
}

export async function findPersonByBadge(
  badgeId: string,
): Promise<{ person: ScannerPerson | null; revoked: boolean }> {
  const database = await db();
  const row = await database.getFirstAsync<PersonRow>(
    `SELECT * FROM scanner_people WHERE badge_id = ?`,
    badgeId,
  );
  if (row) return { person: personFromRow(row), revoked: false };
  const revoked = await database.getFirstAsync<{ badge_id: string }>(
    `SELECT badge_id FROM revoked_badges WHERE badge_id = ?`,
    badgeId,
  );
  if (revoked) return { person: null, revoked: true };
  return { person: null, revoked: false };
}

export async function listScannerActivities(): Promise<ScannerActivity[]> {
  const rows = await (await db()).getAllAsync<{
    id: number;
    name: string;
    category: string;
    requires_scan: number;
  }>(`SELECT * FROM scanner_activities ORDER BY name, id`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    requiresScan: row.requires_scan === 1,
  }));
}

export async function getActivityState(
  userId: number,
  activityId: number,
): Promise<ScannerActivityState> {
  const row = await (await db()).getFirstAsync<{
    scan_count: number;
    entitled: number;
  }>(
    `SELECT scan_count, entitled FROM scanner_activity_states
      WHERE user_id = ? AND activity_id = ?`,
    userId,
    activityId,
  );
  return {
    userId,
    activityId,
    count: row?.scan_count ?? 0,
    entitled: row?.entitled === 1,
  };
}

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export async function enqueueLocalScan(payload: ScanPayload): Promise<string> {
  const database = await db();
  const id = makeId();
  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO pending_scans (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
      id,
      payload.kind,
      JSON.stringify(payload),
      now,
    );

    // Offline-safe local feedback. Accreditation is intentionally excluded:
    // it is never final locally and only becomes assigned after server OK.
    if (payload.kind === "badge_rotation") {
      await database.runAsync(
        `INSERT OR IGNORE INTO revoked_badges (badge_id) VALUES (?)`,
        payload.currentBadgeId,
      );
      await database.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
        payload.newBadgeId,
        payload.userId,
      );
    } else if (payload.kind === "badge_removal") {
      await database.runAsync(
        `INSERT OR IGNORE INTO revoked_badges (badge_id) VALUES (?)`,
        payload.currentBadgeId,
      );
      await database.runAsync(
        `UPDATE scanner_people SET badge_id = NULL WHERE user_id = ?`,
        payload.userId,
      );
    } else if (payload.kind === "presence") {
      await database.runAsync(
        `UPDATE scanner_people SET last_presence_kind = ?, last_presence_at = ? WHERE badge_id = ?`,
        payload.direction,
        payload.scannedAt,
        payload.badgeId,
      );
    } else if (payload.kind === "activity") {
      const owner = await database.getFirstAsync<{ user_id: number }>(
        `SELECT user_id FROM scanner_people WHERE badge_id = ?`,
        payload.badgeId,
      );
      if (owner) {
        await database.runAsync(
          `INSERT INTO scanner_activity_states (user_id, activity_id, scan_count, entitled)
           VALUES (?, ?, 1, 0)
           ON CONFLICT(user_id, activity_id)
           DO UPDATE SET scan_count = scan_count + 1`,
          owner.user_id,
          payload.activityId,
        );
      }
    }
  });
  return id;
}

export async function pendingScans(onlyPending = false): Promise<PendingScan[]> {
  const where = onlyPending ? `WHERE status = 'pending'` : "";
  const rows = await (await db()).getAllAsync<{
    id: string;
    kind: PendingScan["kind"];
    payload_json: string;
    status: PendingScan["status"];
    attempts: number;
    last_error: string | null;
    created_at: string;
    acknowledged_at: string | null;
  }>(`SELECT * FROM pending_scans ${where} ORDER BY created_at ASC`);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  }));
}

export async function markScanAttempt(id: string): Promise<void> {
  await (await db()).runAsync(
    `UPDATE pending_scans SET attempts = attempts + 1, last_error = NULL WHERE id = ?`,
    id,
  );
}

export async function acknowledgeScan(id: string, payload: ScanPayload): Promise<void> {
  const database = await db();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `UPDATE pending_scans SET status = 'acknowledged', acknowledged_at = ?, last_error = NULL
        WHERE id = ?`,
      new Date().toISOString(),
      id,
    );
    if (payload.kind === "accreditation") {
      await database.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE ticket_token = ?`,
        payload.badgeId,
        payload.ticketToken,
      );
    } else if (payload.kind === "accreditation_user") {
      await database.runAsync(
        `UPDATE scanner_people SET badge_id = ? WHERE user_id = ?`,
        payload.badgeId,
        payload.userId,
      );
    }
  });
}

export async function failScan(id: string, message: string): Promise<void> {
  await (await db()).runAsync(
    `UPDATE pending_scans SET status = 'failed', last_error = ? WHERE id = ?`,
    message,
    id,
  );
}

export async function noteRetryableError(id: string, message: string): Promise<void> {
  await (await db()).runAsync(`UPDATE pending_scans SET last_error = ? WHERE id = ?`, message, id);
}

export async function retryFailedScans(): Promise<void> {
  await (await db()).runAsync(
    `UPDATE pending_scans SET status = 'pending', last_error = NULL WHERE status = 'failed'`,
  );
}

export async function getScannerMeta(): Promise<{ lastSync: string | null; pending: number }> {
  const database = await db();
  const sync = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM scanner_metadata WHERE key = 'last_sync'`,
  );
  const pending = await database.getFirstAsync<{ count: number }>(
    `SELECT count(*) AS count FROM pending_scans WHERE status = 'pending'`,
  );
  return { lastSync: sync?.value ?? null, pending: pending?.count ?? 0 };
}
