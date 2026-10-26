import type pg from "pg";
import { config } from "../../config.js";
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
 * stands they met. Entries are added only by scanning a badge, ticket or stand
 * tag; there is no browsable directory. Only the owner's own choices
 * (favourite, note) are stored;
 * cards are projected live from the #934 public profile and the public sponsor
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
  /** The person's current public profile card; null while their profile is not visible. */
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
  // are publicly shared right now are ever shown.
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
 * so progress never goes backwards). Hidden sponsors never count. Ordered like
 * the public logo grid (`listPublicSponsors`): enterprise priority (1 = primary,
 * unset last), then name, collected or not. Tag codes never leave the API.
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
  // Scannable companies are listed (locked) even before staff generate their
  // tags: marking a stand scannable comes first in the staff workflow.
  const { rows: tagged } = await pool.query<{ enterprise_id: number }>(
    `SELECT id AS enterprise_id FROM enterprises WHERE stand_scannable`,
  );
  const ids = new Set([
    ...tagged.map((row) => Number(row.enterprise_id)),
    ...entries.map((row) => Number(row.enterprise_id)),
  ]);
  const cards = await visibleSponsorCards(pool, [...ids]);
  const { rows: priorities } = await pool.query<{ id: number; priority: number | null }>(
    `SELECT id, priority FROM enterprises WHERE id = ANY($1::int[])`,
    [[...ids]],
  );
  const priorityOf = new Map(priorities.map((row) => [Number(row.id), row.priority ?? 9999]));
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
  items.sort(
    (a, b) =>
      (priorityOf.get(a.enterpriseId) ?? 9999) - (priorityOf.get(b.enterpriseId) ?? 9999) ||
      NAME_ORDER.compare(a.name, b.name) ||
      a.enterpriseId - b.enterpriseId,
  );
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
async function insertEntry(
  db: pg.PoolClient,
  owner: number,
  target: { userId: number } | { enterpriseId: number },
): Promise<{ created: boolean; row: EntryRow }> {
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
  return { created: inserted.rows[0] !== undefined, row };
}

async function save(
  db: pg.PoolClient,
  owner: number,
  target: { userId: number } | { enterpriseId: number },
): Promise<{ created: boolean; entry: DiaryEntry }> {
  const { created, row } = await insertEntry(db, owner, target);
  const [entry] = await present(db, [row]);
  return { created, entry: entry as DiaryEntry };
}

/**
 * Locks the scanner and the scanned person in ascending id order, so two
 * people scanning each other at once cannot deadlock. Returns whether the
 * scanned person can receive a diary entry right now: an active account with
 * event access (an account being removed is skipped, not refused).
 */
async function lockPair(db: pg.PoolClient, owner: number, target: number): Promise<boolean> {
  let targetUsable = false;
  for (const id of [owner, target].sort((a, b) => a - b)) {
    if (id === owner) {
      await lockOwner(db, owner);
      continue;
    }
    const { rows } = await db.query<{ account_state: string }>(
      `SELECT account_state FROM users WHERE id = $1 AND anonymized_at IS NULL FOR NO KEY UPDATE`,
      [id],
    );
    targetUsable = rows[0]?.account_state === "active" && (await hasEventAccess(db, id));
  }
  return targetUsable;
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
 * A company tag link `https://<web host>/s/<code>` (QR content, NDEF URI
 * record, #935) carries the tag's own code. Links on another host are left
 * as they are and answer `diary_code_unknown`.
 */
export function codeFromScan(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const webHost = new URL(config.WEB_URL).host;
  const match = /^\/s\/([^/]+)\/?$/.exec(url.pathname);
  if (url.host !== webHost || !match?.[1]) return raw;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return raw;
  }
}

class BadgeAssignmentChangedError extends Error {}

async function resolvePersonForScan(db: Queryable, code: string) {
  try {
    return { userId: await personForCode(db, code), error: null };
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      !["diary_code_unknown", "badge_revoked"].includes(error.code)
    )
      throw error;
    return { userId: null, error };
  }
}

/** A combined tag keeps the person as the primary entry for older clients. */
export interface DiaryScanResult extends DiaryEntry {
  relatedEntries?: DiaryEntry[];
}

/**
 * #935: a UID may identify both a person and an explicitly linked company.
 * Save each currently public destination in the same transaction. A hidden,
 * revoked or self person must not prevent collecting an available stand, nor
 * may an unavailable stand prevent saving a shared person. Only person scans
 * are reciprocal; a combined result presents the person first.
 */
export async function saveScanned(
  owner: number,
  scanned: string,
): Promise<{ created: boolean; entry: DiaryScanResult }> {
  const rawCode = codeFromScan(scanned);
  const code = /^[0-9a-f]{14}$/i.test(rawCode) ? rawCode.toUpperCase() : rawCode;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withTransaction(async (db) => {
        await assertAttendee(db, owner);
        const stand = await standEnterpriseForCode(db, code);
        const cards = stand?.scannable
          ? await visibleSponsorCards(db, [stand.enterpriseId])
          : new Map<number, SponsorCard>();
        const collectStand = stand !== null && cards.has(stand.enterpriseId);
        const resolved = await resolvePersonForScan(db, code);
        let { userId } = resolved;
        let personError = resolved.error;
        if (userId === owner) {
          personError = new AppError(409, "diary_self", "This is your own badge");
          userId = null;
        }
        // Resolve before locking so mutual scans always lock accounts in id order.
        const targetUsable = userId !== null ? await lockPair(db, owner, userId) : false;
        if (userId === null) await lockOwner(db, owner);
        // #935: the first read may have preceded a concurrent reassignment. Once
        // both accounts are locked, validate again; retry from scratch to acquire
        // the latest pair in id order rather than storing the old badge holder.
        const current = await resolvePersonForScan(db, code);
        if (current.userId !== resolved.userId || current.error?.code !== resolved.error?.code) {
          throw new BadgeAssignmentChangedError();
        }
        const people = userId !== null ? await visibleDirectoryEntries(db, [userId, owner]) : null;
        let personSaved: { created: boolean; entry: DiaryEntry } | null = null;
        if (userId !== null && targetUsable && people?.has(userId)) {
          personSaved = await save(db, owner, { userId });
          if (people.has(owner)) await insertEntry(db, userId, { userId: owner });
        } else if (userId !== null) {
          personError = new AppError(
            409,
            "profile_not_shared",
            "This person does not share a profile",
          );
        }
        const standSaved =
          collectStand && stand
            ? await save(db, owner, { enterpriseId: stand.enterpriseId })
            : null;
        if (personSaved) {
          return {
            created: personSaved.created || (standSaved?.created ?? false),
            entry: standSaved
              ? { ...personSaved.entry, relatedEntries: [standSaved.entry] }
              : personSaved.entry,
          };
        }
        if (standSaved) return standSaved;
        if (stand !== null)
          throw new AppError(409, "stand_unavailable", "This sponsor is not available yet");
        throw personError ?? new AppError(404, "diary_code_unknown", "Code not recognized");
      });
    } catch (error) {
      if (!(error instanceof BadgeAssignmentChangedError)) throw error;
    }
  }
  throw new ConflictError("Badge assignment changed; scan again");
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
