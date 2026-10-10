import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { assertFixtureEnterpriseScope } from "../logistics/review-fixture-scope.js";
import { ENTERPRISE_HAS_SYNTHETIC } from "./service.js";

/**
 * Sponsor stands (#935). A stand is an enterprise's physical presence at the
 * venue, identified by NFC tag UIDs (7-byte NTAG213, uppercase hex like
 * badges) and/or printable QR tokens. Attendees scan one to save the
 * sponsor's public card in their event diary.
 */

export interface StandTag {
  id: number;
  kind: "nfc" | "qr";
  code: string;
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

function toTag(row: { id: number; kind: "nfc" | "qr"; code: string; created_at: Date }): StandTag {
  return {
    id: Number(row.id),
    kind: row.kind,
    code: row.code,
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
    `SELECT id, kind, code, created_at FROM sponsor_stand_tags
      WHERE enterprise_id = $1 ORDER BY created_at, id`,
    [enterpriseId],
  );
  return rows.map(toTag);
}

/**
 * A stand code must not already identify a person: a current or rotated-away
 * badge, or a ticket token. Codes are unique across stands by constraint.
 */
async function assertCodeFree(db: pg.PoolClient, code: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE badge_id = $1 OR $1 = ANY(badge_id_history)
     UNION ALL
     SELECT 1 FROM tickets WHERE token = $1
     UNION ALL
     SELECT 1 FROM sponsor_stand_tags WHERE code = $1
     LIMIT 1`,
    [code],
  );
  if (rows[0]) throw new ConflictError("This tag is already in use", { code: "stand_tag_in_use" });
}

export async function addStandTag(
  actorId: number,
  enterpriseId: number,
  input: { kind: "nfc"; uid: string } | { kind: "qr" },
): Promise<StandTag> {
  return withTransaction(async (db) => {
    await assertEnterpriseExists(db, actorId, enterpriseId);
    const code = input.kind === "nfc" ? input.uid : newQrToken();
    await assertCodeFree(db, code);
    const { rows } = await db.query(
      `INSERT INTO sponsor_stand_tags (enterprise_id, kind, code)
       VALUES ($1, $2, $3) RETURNING id, kind, code, created_at`,
      [enterpriseId, input.kind, code],
    );
    const tag = toTag(rows[0]);
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand_tag.added",
      after: { tagId: tag.id, kind: tag.kind },
    });
    return tag;
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
    if (!rows[0]) throw new NotFoundError("Stand tag not found");
    await audit(db, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "stand_tag.removed",
      before: { tagId, kind: rows[0].kind },
    });
  });
}

/** Accreditation guard: a stand tag can never become someone's badge (#935). */
export async function assertNotStandTag(db: Queryable, badgeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT 1 FROM sponsor_stand_tags WHERE code = $1`, [badgeId]);
  if (rows[0]) throw new ConflictError("A sponsor stand tag cannot be used as a badge");
}

/** The enterprise a scanned code belongs to, whatever its visibility. */
export async function standEnterpriseForCode(db: Queryable, code: string): Promise<number | null> {
  const { rows } = await db.query(`SELECT enterprise_id FROM sponsor_stand_tags WHERE code = $1`, [
    code.toUpperCase(),
  ]);
  return rows[0] ? Number(rows[0].enterprise_id) : null;
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
