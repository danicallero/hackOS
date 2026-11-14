import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { AppError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { assertFixtureEnterpriseScope } from "../../lib/fixture-queue-scope.js";
import { isSyntheticOperator } from "../../lib/fixture-subject-scope.js";
import { ENTERPRISE_HAS_REAL, ENTERPRISE_HAS_SYNTHETIC } from "./service.js";

/**
 * Company tags (#935). Staff define NFC tags or wristbands (by the 7-byte
 * NTAG UID, uppercase hex like badges) and printable QR tokens for a
 * company; an attendee who scans one collects that company's badge in their
 * event diary ("visited stand X"). Tags belong to the company, never to a
 * representative or participant. The same UID may also be a person's badge;
 * scanning it saves both explicitly linked destinations. The tables keep the
 * original `stand` naming.
 */

export interface StandTag {
  id: number;
  kind: "nfc" | "qr";
  code: string;
  /** Optional staff label to tell a company's tags apart. */
  label: string | null;
  createdAt: string;
}

/** The public sponsor card shown in a diary: nothing beyond the public sponsor page. */
export interface SponsorCard {
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  description: string | null;
  website: string | null;
  challenges: { id: number; name: string }[];
}

const QR_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newQrToken(): string {
  const bytes = randomBytes(16);
  let token = "";
  for (const byte of bytes) token += QR_ALPHABET[byte % QR_ALPHABET.length];
  return `STAND-${token}`;
}

const TAG_COLUMNS = `id, kind, code, label, created_at`;

function toTag(row: {
  id: number;
  kind: "nfc" | "qr";
  code: string;
  label: string | null;
  created_at: Date;
}): StandTag {
  return {
    id: Number(row.id),
    kind: row.kind,
    code: row.code,
    label: row.label ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

async function assertEnterpriseExists(db: Queryable, actorId: number, enterpriseId: number) {
  const { rows } = await db.query(`SELECT 1 FROM enterprises WHERE id = $1 FOR UPDATE`, [
    enterpriseId,
  ]);
  if (!rows[0]) throw new NotFoundError("Enterprise not found");
  await assertFixtureEnterpriseScope(db, actorId, enterpriseId);
}

export async function listStandTags(actorId: number, enterpriseId: number): Promise<StandTag[]> {
  const { rows: exists } = await pool.query(`SELECT 1 FROM enterprises WHERE id = $1`, [
    enterpriseId,
  ]);
  if (!exists[0]) throw new NotFoundError("Enterprise not found");
  await assertFixtureEnterpriseScope(pool, actorId, enterpriseId);
  const { rows } = await pool.query(
    `SELECT ${TAG_COLUMNS} FROM sponsor_stand_tags
      WHERE enterprise_id = $1 ORDER BY created_at, id`,
    [enterpriseId],
  );
  return rows.map(toTag);
}

const IN_USE_MESSAGE = {
  ticket: "This code is already a ticket",
  stand: "This tag is already a company tag",
} as const;

/** A tag that belongs to a company of another edition (plan §9). */
interface ReassignableTag {
  id: number;
  enterpriseId: number;
}

/**
 * #935: person badges and stand tags are independent assignments. Ticket
 * tokens remain reserved; a tag can belong to only one company at a time.
 * Plan §9: the code stays globally unique, but a tag whose company is NOT in
 * the scoped edition (a previous one) is free to be reassigned to a company of
 * the scoped edition; the existing tag is returned in that case. A tag held
 * by a company of the scoped edition is in use.
 */
async function assertCodeFree(
  db: pg.PoolClient,
  code: string,
  target?: { enterpriseId: number },
): Promise<ReassignableTag | null> {
  const { rows } = await db.query<{ used_by: "ticket" | "stand" }>(
    `SELECT 'ticket' AS used_by FROM tickets WHERE token = $1
     UNION ALL
     SELECT 'stand' FROM sponsor_stand_tags t JOIN enterprises e ON e.id = t.enterprise_id
      WHERE t.code = $1 AND e.event_key = current_edition()
     LIMIT 1`,
    [code],
  );
  if (rows[0])
    throw new ConflictError(IN_USE_MESSAGE[rows[0].used_by], {
      code: "stand_tag_in_use",
      usedBy: rows[0].used_by,
    });
  const { rows: previous } = await db.query<{ id: number; enterprise_id: number }>(
    `SELECT t.id, t.enterprise_id FROM sponsor_stand_tags t WHERE t.code = $1 FOR UPDATE OF t`,
    [code],
  );
  if (!previous[0]) return null;
  // Held by another edition: reassignable only to a company of the scoped one.
  const { rows: ok } = target
    ? await db.query(`SELECT 1 FROM enterprises WHERE id = $1 AND event_key = current_edition()`, [
        target.enterpriseId,
      ])
    : { rows: [] };
  if (!ok[0])
    throw new ConflictError(IN_USE_MESSAGE.stand, { code: "stand_tag_in_use", usedBy: "stand" });
  return { id: Number(previous[0].id), enterpriseId: Number(previous[0].enterprise_id) };
}

export async function addStandTag(
  actorId: number,
  enterpriseId: number,
  input:
    | { kind: "nfc"; uid: string; label?: string | null }
    | { kind: "qr"; label?: string | null },
): Promise<StandTag> {
  return withTransaction(async (db) => {
    await assertEnterpriseExists(db, actorId, enterpriseId);
    const code = input.kind === "nfc" ? input.uid : newQrToken();
    const previous = await assertCodeFree(db, code, { enterpriseId });
    if (previous) {
      // Plan §9: an explicit, audited staff action moves a previous edition's
      // tag to this edition's company; its history keeps pointing at the old one.
      const { rows: moved } = await db.query(
        `UPDATE sponsor_stand_tags SET enterprise_id = $2, kind = $3, label = $4
          WHERE id = $1 RETURNING ${TAG_COLUMNS}`,
        [previous.id, enterpriseId, input.kind, input.label ?? null],
      );
      const reassigned = toTag(moved[0]);
      await audit(db, {
        actorId,
        entityType: "enterprise",
        entityId: enterpriseId,
        action: "stand_tag.reassigned",
        before: { tagId: reassigned.id, enterpriseId: previous.enterpriseId },
        after: { tagId: reassigned.id, kind: reassigned.kind, label: reassigned.label },
      });
      return reassigned;
    }
    const { rows } = await db.query(
      `INSERT INTO sponsor_stand_tags (enterprise_id, kind, code, label)
       VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING RETURNING ${TAG_COLUMNS}`,
      [enterpriseId, input.kind, code, input.label ?? null],
    );
    if (!rows[0]) {
      throw new ConflictError(IN_USE_MESSAGE.stand, { code: "stand_tag_in_use", usedBy: "stand" });
    }
    const tag = toTag(rows[0]);
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand_tag.added",
      after: { tagId: tag.id, kind: tag.kind, label: tag.label },
    });
    return tag;
  });
}

/** Set or clear a tag's label. Repeating the current label writes nothing. */
export async function setStandTagLabel(
  actorId: number,
  enterpriseId: number,
  tagId: number,
  label: string | null,
): Promise<{ tag: StandTag; changed: boolean }> {
  return withTransaction(async (db) => {
    await assertEnterpriseExists(db, actorId, enterpriseId);
    const { rows } = await db.query(
      `SELECT ${TAG_COLUMNS} FROM sponsor_stand_tags WHERE id = $1 AND enterprise_id = $2 FOR UPDATE`,
      [tagId, enterpriseId],
    );
    if (!rows[0]) throw new NotFoundError("Company tag not found");
    const before = toTag(rows[0]);
    if (before.label === label) return { tag: before, changed: false };
    const { rows: updated } = await db.query(
      `UPDATE sponsor_stand_tags SET label = $2 WHERE id = $1 RETURNING ${TAG_COLUMNS}`,
      [tagId, label],
    );
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand_tag.labelled",
      before: { tagId, label: before.label },
      after: { tagId, label },
    });
    return { tag: toTag(updated[0]), changed: true };
  });
}

export async function removeStandTag(
  actorId: number,
  enterpriseId: number,
  tagId: number,
): Promise<void> {
  await withTransaction(async (db) => {
    await assertEnterpriseExists(db, actorId, enterpriseId);
    const { rows } = await db.query(
      `DELETE FROM sponsor_stand_tags WHERE id = $1 AND enterprise_id = $2 RETURNING kind`,
      [tagId, enterpriseId],
    );
    if (!rows[0]) throw new NotFoundError("Company tag not found");
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand_tag.removed",
      before: { tagId, kind: rows[0].kind },
    });
  });
}

/** The enterprise owning a scanned code, with its edition and the scoped one. */
export interface StandCodeOwner {
  enterpriseId: number;
  scannable: boolean;
  /** Edition of the owning enterprise. */
  eventKey: string;
  /** Edition the scan runs in (`current_edition()`). */
  scopedKey: string;
  editionStatus: "draft" | "active" | "closed";
}

/**
 * The enterprise a scanned code belongs to, whatever its visibility, and
 * whether staff made its stand scannable (migration 0703). The caller decides
 * what a code of another edition means (closed: `EditionClosedError`).
 */
export async function standEnterpriseForCode(
  db: Queryable,
  code: string,
): Promise<StandCodeOwner | null> {
  const { rows } = await db.query(
    `SELECT t.enterprise_id, e.stand_scannable, e.event_key, ed.status AS edition_status,
            current_edition() AS scoped_key
       FROM sponsor_stand_tags t
       JOIN enterprises e ON e.id = t.enterprise_id
       JOIN editions ed ON ed.event_key = e.event_key
      WHERE t.code = $1 FOR SHARE OF t, e`,
    [code.toUpperCase()],
  );
  return rows[0]
    ? {
        enterpriseId: Number(rows[0].enterprise_id),
        scannable: rows[0].stand_scannable === true,
        eventKey: String(rows[0].event_key),
        scopedKey: String(rows[0].scoped_key),
        editionStatus: rows[0].edition_status,
      }
    : null;
}

/**
 * Public cards of the given enterprises that are revealed right now (H45
 * visibility, never a review fixture), keyed by enterprise id. Challenges are
 * the published ones the enterprise authored.
 */
export async function visibleSponsorCards(
  db: Queryable,
  enterpriseIds: number[],
): Promise<Map<number, SponsorCard>> {
  if (enterpriseIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT e.id, e.name, e.logo_url, COALESCE(e.logo_negative_url, e.logo_url) AS logo_negative_url,
            e.description, e.website,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.title) ORDER BY c.title, c.id)
                FROM challenges c
                JOIN sponsors s ON s.id = c.author
               WHERE s.enterprise_id = e.id
                 AND c.visibility = 'visible'
                 AND c.is_test_account = false
            ), '[]'::jsonb) AS challenges
       FROM enterprises e
      WHERE e.id = ANY($1::int[])
        AND e.visibility = 'visible'
        AND NOT ${ENTERPRISE_HAS_SYNTHETIC}`,
    [enterpriseIds],
  );
  return new Map(
    rows.map((row) => [
      Number(row.id),
      {
        enterpriseId: Number(row.id),
        name: String(row.name),
        logoUrl: row.logo_url ?? null,
        logoNegativeUrl: row.logo_negative_url ?? null,
        description: row.description ?? null,
        website: row.website ?? null,
        challenges: (row.challenges as { id: number; name: string }[]).map((c) => ({
          id: Number(c.id),
          name: c.name,
        })),
      },
    ]),
  );
}

// ── Staff company-tag management (#935) ─────────────────────────────────────
// Global sponsor administrators (`sponsors:manage`) decide which companies
// attendees can collect and define their tags. Reads and writes keep the
// review-fixture boundary of the enterprise list.

/** One row of the staff Company tags table, with every tag and its serial. */
export interface StandSummary {
  tags: StandTag[];
  enterpriseId: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  visibility: "visible" | "hidden";
  availableFrom: string | null;
  scannable: boolean;
  nfcCount: number;
  qrCount: number;
  /** The newest QR tag, for a one-click SVG download; null without a QR. */
  latestQrTagId: number | null;
}

/** Enterprises the actor may see: real ones, or only fixtures for a synthetic operator. */
async function enterpriseScope(db: Queryable, actorId: number): Promise<string> {
  const markers = (await isSyntheticOperator(db, actorId))
    ? `(${ENTERPRISE_HAS_SYNTHETIC} AND NOT ${ENTERPRISE_HAS_REAL})`
    : `NOT ${ENTERPRISE_HAS_SYNTHETIC}`;
  return `(e.event_key = current_edition() AND ${markers})`;
}

export async function listStands(actorId: number): Promise<StandSummary[]> {
  const scope = await enterpriseScope(pool, actorId);
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.logo_url, COALESCE(e.logo_negative_url, e.logo_url) AS logo_negative_url,
            e.visibility, e.available_from, e.stand_scannable,
            count(t.id) FILTER (WHERE t.kind = 'nfc')::int AS nfc_count,
            count(t.id) FILTER (WHERE t.kind = 'qr')::int AS qr_count,
            (SELECT q.id FROM sponsor_stand_tags q
              WHERE q.enterprise_id = e.id AND q.kind = 'qr'
              ORDER BY q.created_at DESC, q.id DESC LIMIT 1) AS latest_qr_tag_id
       FROM enterprises e
       LEFT JOIN sponsor_stand_tags t ON t.enterprise_id = e.id
      WHERE ${scope}
      GROUP BY e.id
      ORDER BY e.name, e.id`,
  );
  const { rows: tagRows } = await pool.query(
    `SELECT enterprise_id, ${TAG_COLUMNS} FROM sponsor_stand_tags
      WHERE enterprise_id = ANY($1::int[]) ORDER BY created_at, id`,
    [rows.map((row) => Number(row.id))],
  );
  const tagsByEnterprise = new Map<number, StandTag[]>();
  for (const row of tagRows) {
    const id = Number(row.enterprise_id);
    tagsByEnterprise.set(id, [...(tagsByEnterprise.get(id) ?? []), toTag(row)]);
  }
  return rows.map((row) => ({
    enterpriseId: Number(row.id),
    name: String(row.name),
    logoUrl: row.logo_url ?? null,
    logoNegativeUrl: row.logo_negative_url ?? null,
    visibility: row.visibility,
    availableFrom: row.available_from ? (row.available_from as Date).toISOString() : null,
    scannable: row.stand_scannable === true,
    nfcCount: Number(row.nfc_count),
    qrCount: Number(row.qr_count),
    latestQrTagId: row.latest_qr_tag_id == null ? null : Number(row.latest_qr_tag_id),
    tags: tagsByEnterprise.get(Number(row.id)) ?? [],
  }));
}

/**
 * Turn an enterprise's stand scanning on or off. Repeating the current value
 * writes nothing and is not audited (`changed: false`).
 */
export async function setStandScannable(
  actorId: number,
  enterpriseId: number,
  scannable: boolean,
): Promise<{ enterpriseId: number; scannable: boolean; changed: boolean }> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<{ stand_scannable: boolean }>(
      `SELECT stand_scannable FROM enterprises WHERE id = $1 FOR UPDATE`,
      [enterpriseId],
    );
    if (!rows[0]) throw new NotFoundError("Enterprise not found");
    await assertFixtureEnterpriseScope(db, actorId, enterpriseId);
    const before = rows[0].stand_scannable;
    if (before === scannable) return { enterpriseId, scannable, changed: false };
    await db.query(`UPDATE enterprises SET stand_scannable = $2 WHERE id = $1`, [
      enterpriseId,
      scannable,
    ]);
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand.scannable_changed",
      before: { scannable: before },
      after: { scannable },
    });
    return { enterpriseId, scannable, changed: true };
  });
}

/**
 * Generate one QR tag for every scannable enterprise that has none. The
 * enterprises are locked first (the same lock a single tag write takes), so a
 * concurrent or repeated run finds the QR the other one created and adds
 * nothing. Each created tag is audited like a single one.
 */
export async function generateMissingQrTags(
  actorId: number,
): Promise<{ created: { enterpriseId: number; name: string; tag: StandTag }[] }> {
  return withTransaction(async (db) => {
    const scope = await enterpriseScope(db, actorId);
    const { rows: locked } = await db.query<{ id: number; name: string }>(
      `SELECT e.id, e.name FROM enterprises e
        WHERE e.stand_scannable AND ${scope}
        ORDER BY e.id
        FOR UPDATE OF e`,
    );
    const { rows: withQr } = await db.query<{ enterprise_id: number }>(
      `SELECT DISTINCT enterprise_id FROM sponsor_stand_tags
        WHERE kind = 'qr' AND enterprise_id = ANY($1::int[])`,
      [locked.map((row) => row.id)],
    );
    const covered = new Set(withQr.map((row) => Number(row.enterprise_id)));
    const created: { enterpriseId: number; name: string; tag: StandTag }[] = [];
    for (const enterprise of locked) {
      const enterpriseId = Number(enterprise.id);
      if (covered.has(enterpriseId)) continue;
      const code = newQrToken();
      await assertCodeFree(db, code);
      const { rows } = await db.query(
        `INSERT INTO sponsor_stand_tags (enterprise_id, kind, code)
         VALUES ($1, 'qr', $2) RETURNING ${TAG_COLUMNS}`,
        [enterpriseId, code],
      );
      const tag = toTag(rows[0]);
      await audit(db, {
        actorId,
        entityType: "enterprise",
        entityId: enterpriseId,
        action: "stand_tag.added",
        after: { tagId: tag.id, kind: tag.kind, bulk: true },
      });
      created.push({ enterpriseId, name: String(enterprise.name), tag });
    }
    return { created };
  });
}

interface StandCode {
  enterpriseId: number;
  name: string;
  kind: "nfc" | "qr";
  code: string;
  label: string | null;
}

/**
 * Every code of the scannable stands, for printing outside hackOS. Codes are
 * what an attendee scans, so the export is audited with its format and size
 * (never the codes). Nothing to export is an explicit 409.
 */
export async function exportStandCodes(
  actorId: number,
  format: "csv" | "svg",
): Promise<StandCode[]> {
  return withTransaction(async (db) => {
    const scope = await enterpriseScope(db, actorId);
    const { rows } = await db.query(
      `SELECT e.id, e.name, t.kind, t.code, t.label
         FROM sponsor_stand_tags t
         JOIN enterprises e ON e.id = t.enterprise_id
        WHERE e.stand_scannable AND ${scope}
          AND ($1::text = 'csv' OR t.kind = 'qr')
        ORDER BY e.name, e.id, t.kind, t.created_at, t.id`,
      [format],
    );
    if (rows.length === 0) {
      throw new AppError(409, "stand_codes_empty", "No scannable stand has a code to export yet");
    }
    const codes = rows.map(
      (row): StandCode => ({
        enterpriseId: Number(row.id),
        name: String(row.name),
        kind: row.kind,
        code: String(row.code),
        label: row.label ?? null,
      }),
    );
    await audit(db, {
      actorId,
      entityType: "stand_codes",
      entityId: "all",
      action: "stand_codes.exported",
      after: {
        format,
        codeCount: codes.length,
        enterpriseCount: new Set(codes.map((code) => code.enterpriseId)).size,
      },
    });
    return codes;
  });
}

/** One QR tag of an enterprise with the company name, for its printable SVG. */
export async function standQrTag(
  actorId: number,
  enterpriseId: number,
  tagId: number,
): Promise<{ name: string; code: string }> {
  const { rows } = await pool.query(
    `SELECT e.name, t.code FROM sponsor_stand_tags t JOIN enterprises e ON e.id = t.enterprise_id
      WHERE t.id = $1 AND t.enterprise_id = $2 AND t.kind = 'qr'`,
    [tagId, enterpriseId],
  );
  if (!rows[0]) throw new NotFoundError("Stand QR not found");
  await assertFixtureEnterpriseScope(pool, actorId, enterpriseId);
  return { name: String(rows[0].name), code: String(rows[0].code) };
}
