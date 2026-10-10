import type pg from "pg";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { type DirectoryEntry, visibleDirectoryEntries } from "../directory/service.js";
import { hasEventAccess } from "../identity/role.js";
import { resolveByBadge } from "../logistics/badge.js";
import {
  type SponsorCard,
  standEnterpriseForCode,
  visibleSponsorCards,
} from "../sponsors/stands.js";
import type { UpdateEntryInput } from "./schemas.js";

/**
 * Event diary (#935): an attendee's private list of the people and sponsor
 * stands they met. Only the owner's own choices (favourite, note) are stored;
 * cards are projected live from the #934 directory and the public sponsor
 * profile, so a person who hides their profile — or a sponsor that is hidden
 * again — shows as unavailable instead of as a stale copy.
 */
export interface DiaryEntry {
  id: number;
  kind: "person" | "sponsor";
  starred: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** The person's current directory card; null while their profile is not visible. */
  person: DirectoryEntry | null;
  /** The sponsor's current public card; null while the sponsor is not revealed. */
  sponsor: SponsorCard | null;
}

interface EntryRow {
  id: number;
  target_user_id: number | null;
  enterprise_id: number | null;
  starred: boolean;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const ENTRY_COLUMNS = `id, target_user_id, enterprise_id, starred, note, created_at, updated_at`;

async function present(db: Queryable, rows: EntryRow[]) {
  // Every attendee may keep the people they met (#935), but only cards that
  // are directory-visible right now are ever shown.
  const people = await visibleDirectoryEntries(
    db,
    rows.flatMap((row) => (row.target_user_id ? [Number(row.target_user_id)] : [])),
  );
  const sponsors = await visibleSponsorCards(
    db,
    rows.flatMap((row) => (row.enterprise_id ? [Number(row.enterprise_id)] : [])),
  );
  return rows.map(
    (row): DiaryEntry => ({
      id: Number(row.id),
      kind: row.target_user_id ? "person" : "sponsor",
      starred: row.starred,
      note: row.note,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      person: row.target_user_id ? (people.get(Number(row.target_user_id)) ?? null) : null,
      sponsor: row.enterprise_id ? (sponsors.get(Number(row.enterprise_id)) ?? null) : null,
    }),
  );
}

async function assertAttendee(db: Queryable, userId: number): Promise<void> {
  if (!(await hasEventAccess(db, userId))) {
    throw new ForbiddenError("The event diary is only available to event attendees");
  }
}

/**
 * Serializes the owner's diary writes and refuses accounts being removed
 * (H54) explicitly instead of letting the trigger answer with a 500.
 */
async function lockOwner(db: pg.PoolClient, userId: number): Promise<void> {
  const { rows } = await db.query<{ account_state: string }>(
    `SELECT account_state FROM users WHERE id = $1 AND anonymized_at IS NULL FOR NO KEY UPDATE`,
    [userId],
  );
  if (rows[0]?.account_state === "removal_pending") {
    throw new ConflictError("This account is being removed");
  }
  if (!rows[0]) throw new ForbiddenError("The event diary is only available to event attendees");
  await assertAttendee(db, userId);
}

/** Starred first, then most recently saved. */
export async function listDiary(owner: number): Promise<{ items: DiaryEntry[] }> {
  await assertAttendee(pool, owner);
  const { rows } = await pool.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM diary_entries
      WHERE owner_id = $1
      ORDER BY starred DESC, created_at DESC, id DESC`,
    [owner],
  );
  return { items: await present(pool, rows) };
}

/** One company in the attendee's stand collection (#935). */
export interface SponsorCollectionItem extends SponsorCard {
  /** The caller's diary entry once they scanned the stand; null while still to collect. */
  entry: { id: number; starred: boolean; note: string | null; createdAt: string } | null;
}

const NAME_ORDER = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/**
 * The sponsor stands an attendee can collect (#935): every revealed sponsor
 * whose stand staff made scannable and that has a stand tag, plus revealed
 * sponsors the caller already collected even if their tags were removed or
 * scanning was turned off since (they count in both `collected` and `total`,
 * so progress never goes backwards). Hidden sponsors never count. Collected
 * first (newest first), then the rest by name. Tag codes never leave the API.
 */
export async function listSponsorCollection(owner: number): Promise<{
  total: number;
  collected: number;
  items: SponsorCollectionItem[];
}> {
  await assertAttendee(pool, owner);
  const { rows: entries } = await pool.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM diary_entries
      WHERE owner_id = $1 AND enterprise_id IS NOT NULL`,
    [owner],
  );
  const { rows: tagged } = await pool.query<{ enterprise_id: number }>(
    `SELECT DISTINCT t.enterprise_id
       FROM sponsor_stand_tags t JOIN enterprises e ON e.id = t.enterprise_id
      WHERE e.stand_scannable`,
  );
  const ids = new Set([
    ...tagged.map((row) => Number(row.enterprise_id)),
    ...entries.map((row) => Number(row.enterprise_id)),
  ]);
  const cards = await visibleSponsorCards(pool, [...ids]);
  const byEnterprise = new Map(entries.map((row) => [Number(row.enterprise_id), row]));
  const items = [...cards.values()].map((card): SponsorCollectionItem => {
    const row = byEnterprise.get(card.enterpriseId);
    return {
      ...card,
      entry: row
        ? {
            id: Number(row.id),
            starred: row.starred,
            note: row.note,
            createdAt: row.created_at.toISOString(),
          }
        : null,
    };
  });
  items.sort((a, b) => {
    if (a.entry && b.entry) {
      return b.entry.createdAt.localeCompare(a.entry.createdAt) || b.entry.id - a.entry.id;
    }
    if (a.entry || b.entry) return a.entry ? -1 : 1;
    return NAME_ORDER.compare(a.name, b.name) || a.enterpriseId - b.enterpriseId;
  });
  return {
    total: items.length,
    collected: items.filter((item) => item.entry !== null).length,
    items,
  };
}

/**
 * Insert-or-return: the partial unique indexes make a concurrent double save
 * converge on one row, and a re-scan returns the existing entry untouched.
 */
async function save(
  db: pg.PoolClient,
  owner: number,
  target: { userId: number } | { enterpriseId: number },
): Promise<{ created: boolean; entry: DiaryEntry }> {
  const [column, value] =
    "userId" in target ? ["target_user_id", target.userId] : ["enterprise_id", target.enterpriseId];
  const inserted = await db.query<EntryRow>(
    `INSERT INTO diary_entries (owner_id, ${column}) VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING ${ENTRY_COLUMNS}`,
    [owner, value],
  );
  const row =
    inserted.rows[0] ??
    (
      await db.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM diary_entries WHERE owner_id = $1 AND ${column} = $2`,
        [owner, value],
      )
    ).rows[0];
  if (!row) throw new ConflictError("The diary entry could not be saved");
  const [entry] = await present(db, [row]);
  return { created: inserted.rows[0] !== undefined, entry: entry as DiaryEntry };
}

/** A badge (current NFC UID or badge QR) or a ticket QR, to its holder. */
async function personForCode(db: Queryable, code: string): Promise<number> {
  try {
    return await resolveByBadge(db, code);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "badge_unknown") throw err;
  }
  const { rows } = await db.query(
    `SELECT t.user_id FROM tickets t JOIN users u ON u.id = t.user_id
      WHERE t.token = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
    [code],
  );
  if (rows[0]) return Number(rows[0].user_id);
  throw new AppError(404, "diary_code_unknown", "Code not recognized");
}

/**
 * Save whatever was scanned: a sponsor stand tag/QR, or a person's badge or
 * ticket. Nothing about a person is revealed unless their profile is visible
 * right now; otherwise the answer is `profile_not_shared` and nothing is
 * stored. The scanned person is never notified.
 */
export async function saveScanned(owner: number, code: string) {
  return withTransaction(async (db) => {
    await lockOwner(db, owner);
    const stand = await standEnterpriseForCode(db, code);
    if (stand !== null) {
      const { enterpriseId } = stand;
      // Staff decide which stands can be collected (0703); a stand that is
      // not scannable answers like an unrevealed sponsor and names no one.
      const cards = stand.scannable
        ? await visibleSponsorCards(db, [enterpriseId])
        : new Map<number, SponsorCard>();
      if (!cards.has(enterpriseId)) {
        throw new AppError(409, "stand_unavailable", "This sponsor is not available yet");
      }
      return save(db, owner, { enterpriseId });
    }
    const userId = await personForCode(db, code);
    if (userId === owner) {
      throw new AppError(409, "diary_self", "This is your own badge");
    }
    const people = await visibleDirectoryEntries(db, [userId]);
    if (!people.has(userId)) {
      throw new AppError(409, "profile_not_shared", "This person does not share a profile");
    }
    return save(db, owner, { userId });
  });
}

/** Save someone found in the directory; hidden and missing are the same 404 (#934). */
export async function savePerson(owner: number, userId: number) {
  return withTransaction(async (db) => {
    await lockOwner(db, owner);
    const people = await visibleDirectoryEntries(db, [userId]);
    if (userId === owner || !people.has(userId)) {
      throw new NotFoundError("Person not found");
    }
    return save(db, owner, { userId });
  });
}

export async function updateEntry(owner: number, entryId: number, input: UpdateEntryInput) {
  return withTransaction(async (db) => {
    await lockOwner(db, owner);
    const { rows } = await db.query<EntryRow>(
      `UPDATE diary_entries
          SET starred = COALESCE($3, starred),
              note = CASE WHEN $4 THEN $5 ELSE note END
        WHERE id = $1 AND owner_id = $2
        RETURNING ${ENTRY_COLUMNS}`,
      [entryId, owner, input.starred ?? null, input.note !== undefined, input.note ?? null],
    );
    if (!rows[0]) throw new NotFoundError("Diary entry not found");
    const [entry] = await present(db, rows);
    return entry as DiaryEntry;
  });
}

export async function removeEntry(owner: number, entryId: number): Promise<void> {
  await withTransaction(async (db) => {
    await lockOwner(db, owner);
    const { rowCount } = await db.query(
      `DELETE FROM diary_entries WHERE id = $1 AND owner_id = $2`,
      [entryId, owner],
    );
    if (!rowCount) throw new NotFoundError("Diary entry not found");
  });
}
