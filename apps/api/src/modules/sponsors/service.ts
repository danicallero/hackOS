import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import {
  assertFixtureEnterpriseScope,
  assertFixtureSubjectScope,
  isSyntheticOperator,
} from "../logistics/review-fixture-scope.js";
import { issueTicket } from "../logistics/tickets.js";
import type { CreateEnterpriseBody, FaqItem, UpdateEnterpriseBody } from "./schemas.js";

const COLUMNS = `id, name, website, logo_url,
  COALESCE(logo_negative_url, logo_url) AS logo_negative_url, description, tier_id,
  display_priority, visibility, available_from, director_id, created_at`;

const COLUMN_FOR: Record<string, string> = {
  name: "name",
  website: "website",
  logoUrl: "logo_url",
  logoNegativeUrl: "logo_negative_url",
  description: "description",
  tierId: "tier_id",
  displayPriority: "display_priority",
  visibility: "visibility",
  availableFrom: "available_from",
};

// Enterprises have no marker column of their own. A marker is inherited from
// their sponsor users or authored challenges; mixed graphs fail closed in
// assertFixtureEnterpriseScope. Keep the list/public queries on the same
// boundary so a global operator cannot discover a fixture by id or visibility.
const ENTERPRISE_HAS_SYNTHETIC = `(
  EXISTS (
    SELECT 1 FROM sponsors marker_sponsor
    JOIN users marker_user ON marker_user.id = marker_sponsor.user_id
    WHERE marker_sponsor.enterprise_id = e.id AND marker_user.is_test_account = true
  )
  OR EXISTS (
    SELECT 1 FROM sponsors marker_author
    JOIN challenges marker_challenge ON marker_challenge.author = marker_author.id
    WHERE marker_author.enterprise_id = e.id AND marker_challenge.is_test_account = true
  )
)`;

const ENTERPRISE_HAS_REAL = `(
  EXISTS (
    SELECT 1 FROM sponsors marker_sponsor
    JOIN users marker_user ON marker_user.id = marker_sponsor.user_id
    WHERE marker_sponsor.enterprise_id = e.id AND marker_user.is_test_account = false
  )
  OR EXISTS (
    SELECT 1 FROM sponsors marker_author
    JOIN challenges marker_challenge ON marker_challenge.author = marker_author.id
    WHERE marker_author.enterprise_id = e.id AND marker_challenge.is_test_account = false
  )
)`;

async function assertEnterpriseScope(
  db: Queryable,
  actorId: number | null,
  enterpriseId: number,
): Promise<void> {
  if (actorId != null) await assertFixtureEnterpriseScope(db, actorId, enterpriseId);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export async function getEnterprise(id: number) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM enterprises WHERE id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
  return rows[0];
}

export async function listEnterprises(actorId: number) {
  const syntheticOperator = await isSyntheticOperator(pool, actorId);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM enterprises e
      WHERE (($1::boolean AND ${ENTERPRISE_HAS_SYNTHETIC} AND NOT ${ENTERPRISE_HAS_REAL})
         OR (NOT $1::boolean AND NOT ${ENTERPRISE_HAS_SYNTHETIC}))
      ORDER BY name`,
    [syntheticOperator],
  );
  return rows;
}

/** The enterprise `userId` is a sponsor rep of (H44 "mi empresa"). */
export async function myEnterprise(userId: number) {
  const syntheticOperator = await isSyntheticOperator(pool, userId);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM enterprises e
      WHERE id = (SELECT enterprise_id FROM sponsors WHERE user_id = $1 ORDER BY id LIMIT 1)
        AND (($2::boolean AND ${ENTERPRISE_HAS_SYNTHETIC} AND NOT ${ENTERPRISE_HAS_REAL})
          OR (NOT $2::boolean AND NOT ${ENTERPRISE_HAS_SYNTHETIC}))`,
    [userId, syntheticOperator],
  );
  if (!rows[0]) throw new NotFoundError("You are not linked to an enterprise", { userId });
  return rows[0];
}

export async function createEnterprise(input: CreateEnterpriseBody, actorId: number | null) {
  if (actorId != null && (await isSyntheticOperator(pool, actorId))) {
    throw new ForbiddenError("Synthetic operators cannot create real sponsor enterprises.", {
      code: "review_fixture_scope",
    });
  }
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO enterprises
           (name, website, logo_url, logo_negative_url, description, tier_id, display_priority, visibility, available_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          input.name,
          input.website ?? null,
          input.logoUrl ?? null,
          input.logoNegativeUrl ?? null,
          input.description ?? null,
          input.tierId ?? null,
          input.displayPriority ?? null,
          input.visibility,
          input.availableFrom ?? null,
        ],
      );
      await audit(client, {
        actorId,
        entityType: "enterprise",
        entityId: rows[0].id,
        action: "created",
        after: { name: input.name },
      });
      return rows[0];
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError("An enterprise with that name already exists", { name: input.name });
    throw err;
  }
}

export async function updateEnterprise(
  id: number,
  patch: UpdateEnterpriseBody,
  actorId: number | null,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, col] of Object.entries(COLUMN_FOR)) {
    const val = (patch as Record<string, unknown>)[key];
    if (val !== undefined) {
      sets.push(`${col} = $${i}`);
      values.push(val ?? null);
      i += 1;
    }
  }
  values.push(id);
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE enterprises SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
      await audit(client, {
        actorId,
        entityType: "enterprise",
        entityId: id,
        action: "updated",
        after: { fields: Object.keys(patch) },
      });
      return rows[0];
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError("An enterprise with that name already exists");
    throw err;
  }
}

/**
 * Admin bulk visibility flip from the enterprises list (H45). Making enterprises
 * visible reveals them immediately; hiding pulls them from the public sponsor
 * reveal. `available_from` is a trigger, not a visibility filter, so bulk
 * changes leave it untouched. Each enterprise is audited.
 */
export async function setEnterprisesVisibility(
  ids: number[],
  visible: boolean,
  actorId: number | null,
) {
  if (ids.length === 0) return { updated: [] as number[] };
  return withTransaction(async (client) => {
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM enterprises WHERE id = ANY($1::int[])`,
      [ids],
    );
    for (const row of existing.rows) await assertEnterpriseScope(client, actorId, Number(row.id));
    const visibility = visible ? "visible" : "hidden";
    const { rows } = await client.query(
      `UPDATE enterprises
          SET visibility = $2
        WHERE id = ANY($1::int[])
        RETURNING id`,
      [ids, visibility],
    );
    for (const row of rows) {
      await audit(client, {
        actorId,
        entityType: "enterprise",
        entityId: Number(row.id),
        action: "updated",
        after: { visibility },
      });
    }
    return { updated: rows.map((r) => Number(r.id)) };
  });
}

export async function setEnterpriseLogo(
  id: number,
  logoUrl: string,
  variant: "default" | "negative",
  actorId: number | null,
) {
  const column = variant === "negative" ? "logo_negative_url" : "logo_url";
  return withTransaction(async (client) => {
    await assertEnterpriseScope(client, actorId, id);
    const { rows } = await client.query(
      `UPDATE enterprises SET ${column} = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
      [logoUrl, id],
    );
    if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
    await audit(client, {
      actorId,
      entityType: "enterprise",
      entityId: id,
      action: variant === "negative" ? "negative_logo_updated" : "logo_updated",
      after: { logoUrl, variant },
    });
    return rows[0];
  });
}

// ── enterprise membership (M4: the sponsors table IS the user↔enterprise link) ─

export interface EnterpriseMember {
  sponsorId: number;
  userId: number;
  name: string | null;
  email: string;
  joinedAt: Date;
}

/** Users affiliated with an enterprise (its `sponsors` rows joined to users). */
export async function listEnterpriseMembers(
  enterpriseId: number,
  actorId: number | null,
): Promise<EnterpriseMember[]> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  await getEnterprise(enterpriseId); // 404 if it doesn't exist
  const { rows } = await pool.query(
    `SELECT s.id AS sponsor_id, s.user_id, u.name, u.email, s.joined_at
       FROM sponsors s
       JOIN users u ON u.id = s.user_id
      WHERE s.enterprise_id = $1
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      ORDER BY u.name NULLS LAST, u.email`,
    [enterpriseId],
  );
  return rows.map((r: Record<string, unknown>) => ({
    sponsorId: Number(r.sponsor_id),
    userId: Number(r.user_id),
    name: (r.name as string | null) ?? null,
    email: String(r.email),
    joinedAt: r.joined_at as Date,
  }));
}

/** Enterprises a user is affiliated with (for the profile's Enterprise view). */
export async function listUserEnterprises(userId: number, actorId: number | null) {
  let markerFilter = "";
  const params: unknown[] = [userId];
  if (actorId != null) {
    await assertFixtureSubjectScope(pool, actorId, userId);
    const syntheticOperator = await isSyntheticOperator(pool, actorId);
    params.push(syntheticOperator);
    markerFilter = `
        AND (($2::boolean AND ${ENTERPRISE_HAS_SYNTHETIC} AND NOT ${ENTERPRISE_HAS_REAL})
          OR (NOT $2::boolean AND NOT ${ENTERPRISE_HAS_SYNTHETIC}))`;
  }
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM enterprises e
      WHERE id IN (SELECT enterprise_id FROM sponsors WHERE user_id = $1)
        ${markerFilter}
      ORDER BY name`,
    params,
  );
  return rows;
}

/** Affiliate a user with an enterprise. Idempotent-safe: 409 if already linked. */
export async function addEnterpriseMember(
  enterpriseId: number,
  userId: number,
  actorId: number | null,
): Promise<EnterpriseMember> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  await getEnterprise(enterpriseId); // 404 if the enterprise is missing
  const { member, user } = await withTransaction(async (client) => {
    // Serialize the target against H54 removal. A pending account must not
    // receive a new sponsor relation, ticket, or audit row while its
    // identity-bearing graph is being scrubbed.
    const { rows: userRows } = await client.query(
      `SELECT id, name, email FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found", { userId });
    if (actorId != null) await assertFixtureSubjectScope(client, actorId, userId);
    const { rows: existing } = await client.query(
      `SELECT id FROM sponsors WHERE enterprise_id = $1 AND user_id = $2`,
      [enterpriseId, userId],
    );
    if (existing[0]) {
      throw new ConflictError("User is already affiliated with this enterprise", {
        enterpriseId,
        userId,
      });
    }
    const { rows } = await client.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id, joined_at`,
      [enterpriseId, userId],
    );
    await issueTicket(client, userId);
    await audit(client, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "member_added",
      after: { userId },
    });
    return { member: rows[0], user: userRows[0] };
  });
  return {
    sponsorId: Number(member.id),
    userId,
    name: (user.name as string | null) ?? null,
    email: String(user.email),
    joinedAt: member.joined_at as Date,
  };
}

/** Remove a user's affiliation with an enterprise. */
export async function removeEnterpriseMember(
  enterpriseId: number,
  userId: number,
  actorId: number | null,
): Promise<void> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  if (actorId != null) await assertFixtureSubjectScope(pool, actorId, userId);
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM sponsors WHERE enterprise_id = $1 AND user_id = $2`,
      [enterpriseId, userId],
    );
    if (!rowCount) {
      throw new NotFoundError("User is not affiliated with this enterprise", {
        enterpriseId,
        userId,
      });
    }
    await audit(client, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "member_removed",
      after: { userId },
    });
  });
}

// ── judge roster (DELTA(Hxx): enterprise_judges replaces room_judges) ─────────

export interface EnterpriseJudge {
  userId: number;
  name: string | null;
  surname: string | null;
  email: string;
  addedAt: Date;
  addedBy: number | null;
}

function judgeRow(r: Record<string, unknown>): EnterpriseJudge {
  return {
    userId: Number(r.user_id),
    name: (r.name as string | null) ?? null,
    surname: (r.surname as string | null) ?? null,
    email: String(r.email),
    addedAt: r.added_at as Date,
    addedBy: r.added_by == null ? null : Number(r.added_by),
  };
}

/** The enterprise's judge roster: any user, not only its sponsor reps. */
export async function listEnterpriseJudges(
  enterpriseId: number,
  actorId: number | null,
): Promise<EnterpriseJudge[]> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  await getEnterprise(enterpriseId); // 404 if it doesn't exist
  const { rows } = await pool.query(
    `SELECT ej.user_id, u.name, u.surname, u.email, ej.added_at, ej.added_by
       FROM enterprise_judges ej
       JOIN users u ON u.id = ej.user_id
      WHERE ej.enterprise_id = $1
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
      ORDER BY u.name NULLS LAST, u.surname NULLS LAST, u.email`,
    [enterpriseId],
  );
  return rows.map(judgeRow);
}

/**
 * Add a judge. The candidate pool is every account (an enterprise may bring
 * outside judges), and the add is silent — no invitation or consent step; the
 * judge simply finds the judging workspace on their next login.
 */
export async function addEnterpriseJudge(
  enterpriseId: number,
  userId: number,
  actorId: number | null,
): Promise<EnterpriseJudge> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  await getEnterprise(enterpriseId);
  return withTransaction(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found", { userId });
    if (actorId != null) await assertFixtureSubjectScope(client, actorId, userId);
    const { rows } = await client.query(
      `INSERT INTO enterprise_judges (enterprise_id, user_id, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (enterprise_id, user_id) DO NOTHING
       RETURNING user_id`,
      [enterpriseId, userId, actorId],
    );
    if (!rows[0]) {
      throw new ConflictError("User is already a judge for this enterprise", {
        enterpriseId,
        userId,
      });
    }
    await audit(client, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "judge_added",
      after: { userId },
    });
    const { rows: judges } = await client.query(
      `SELECT ej.user_id, u.name, u.surname, u.email, ej.added_at, ej.added_by
         FROM enterprise_judges ej
         JOIN users u ON u.id = ej.user_id
        WHERE ej.enterprise_id = $1 AND ej.user_id = $2
          AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
      [enterpriseId, userId],
    );
    return judgeRow(judges[0]);
  });
}

/** Remove a judge; their contextual access to the enterprise's rooms goes with it. */
export async function removeEnterpriseJudge(
  enterpriseId: number,
  userId: number,
  actorId: number | null,
): Promise<void> {
  await assertEnterpriseScope(pool, actorId, enterpriseId);
  if (actorId != null) await assertFixtureSubjectScope(pool, actorId, userId);
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM enterprise_judges WHERE enterprise_id = $1 AND user_id = $2`,
      [enterpriseId, userId],
    );
    if (!rowCount) {
      throw new NotFoundError("User is not a judge for this enterprise", { enterpriseId, userId });
    }
    await audit(client, {
      actorId,
      entityType: "enterprise",
      entityId: enterpriseId,
      action: "judge_removed",
      before: { userId },
    });
  });
}

/**
 * Candidate pool for the judge picker: every account, unscoped — an enterprise
 * may add judges who are neither its reps nor event participants.
 */
export async function listJudgeCandidates(actorId: number) {
  const syntheticOperator = await isSyntheticOperator(pool, actorId);
  const { rows } = await pool.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = $1
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT 500`,
    [syntheticOperator],
  );
  return rows;
}

export interface PublicSponsor {
  enterpriseId: number;
  name: string;
  website: string | null;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  priority: number;
}

/**
 * Publicly-revealed sponsors for the website / TV logo grid (H45). Driven by
 * the enterprise's own visibility; scheduled reveal is handled by the background
 * trigger. Ordered by display priority (1 = primary / biggest), falling back to
 * the sponsor tier's logo_priority.
 */
export async function listPublicSponsors(client: Queryable = pool): Promise<PublicSponsor[]> {
  const { rows } = await client.query(
    `SELECT e.id AS enterprise_id, e.name, e.website, e.logo_url,
            COALESCE(e.logo_negative_url, e.logo_url) AS logo_negative_url,
            COALESCE(e.display_priority, st.logo_priority, 9999) AS priority
      FROM enterprises e
       LEFT JOIN sponsor_tiers st ON st.id = e.tier_id
      WHERE e.visibility = 'visible'
        AND NOT ${ENTERPRISE_HAS_SYNTHETIC}
      ORDER BY priority ASC, e.name ASC`,
  );
  return rows.map((r: Record<string, unknown>) => ({
    enterpriseId: Number(r.enterprise_id),
    name: String(r.name),
    website: (r.website as string | null) ?? null,
    logoUrl: (r.logo_url as string | null) ?? null,
    logoNegativeUrl: (r.logo_negative_url as string | null) ?? null,
    priority: Number(r.priority),
  }));
}

/**
 * Scheduled visibility sweep (H45). `available_from` is only a trigger: due
 * hidden rows flip visible, while already-visible rows remain visible even if
 * their timestamp is in the future.
 */
export async function revealDueEnterprises(client: Queryable = pool): Promise<number[]> {
  const { rows } = await client.query(
    `UPDATE enterprises
        SET visibility = 'visible',
            available_from = NULL
      WHERE visibility = 'hidden'
        AND available_from IS NOT NULL
        AND available_from <= now()
      RETURNING id`,
  );
  return rows.map((r: { id: number }) => Number(r.id));
}

/** H58: sponsor-only FAQ, an ordered list of Q&A/text items, singleton row. */
export async function getSponsorFaq(): Promise<{ items: FaqItem[] }> {
  const { rows } = await pool.query(`SELECT items FROM sponsor_faq WHERE id = 1`);
  return { items: rows[0]?.items ?? [] };
}

export async function updateSponsorFaq(
  actorId: number,
  items: FaqItem[],
): Promise<{ items: FaqItem[] }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO sponsor_faq (id, items) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items
       RETURNING items`,
      [JSON.stringify(items)],
    );
    await audit(client, {
      actorId,
      entityType: "sponsor_faq",
      entityId: 1,
      action: "updated",
      after: { items: rows[0].items },
    });
    return { items: rows[0].items };
  });
}
