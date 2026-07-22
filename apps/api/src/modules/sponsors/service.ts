import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { issueTicket } from "../logistics/tickets.js";
import type { CreateEnterpriseBody, UpdateEnterpriseBody } from "./schemas.js";

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

export async function getEnterprise(id: number) {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM enterprises WHERE id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
  return rows[0];
}

export async function listEnterprises() {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM enterprises ORDER BY name`);
  return rows;
}

/** The enterprise `userId` is a sponsor rep of (H44 "mi empresa"). */
export async function myEnterprise(userId: number) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}
       FROM enterprises
      WHERE id = (SELECT enterprise_id FROM sponsors WHERE user_id = $1 ORDER BY id LIMIT 1)`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("You are not linked to an enterprise", { userId });
  return rows[0];
}

export async function createEnterprise(input: CreateEnterpriseBody, actorId: number | null) {
  try {
    const { rows } = await pool.query(
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
    await audit(pool, {
      actorId,
      entityType: "enterprise",
      entityId: rows[0].id,
      action: "created",
      after: { name: input.name },
    });
    return rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
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
    const { rows } = await pool.query(
      `UPDATE enterprises SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
      values,
    );
    if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
    await audit(pool, {
      actorId,
      entityType: "enterprise",
      entityId: id,
      action: "updated",
      after: { fields: Object.keys(patch) },
    });
    return rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
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
  const { rows } = await pool.query(
    `UPDATE enterprises SET ${column} = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
    [logoUrl, id],
  );
  if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
  await audit(pool, {
    actorId,
    entityType: "enterprise",
    entityId: id,
    action: variant === "negative" ? "negative_logo_updated" : "logo_updated",
    after: { logoUrl, variant },
  });
  return rows[0];
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
export async function listEnterpriseMembers(enterpriseId: number): Promise<EnterpriseMember[]> {
  await getEnterprise(enterpriseId); // 404 if it doesn't exist
  const { rows } = await pool.query(
    `SELECT s.id AS sponsor_id, s.user_id, u.name, u.email, s.joined_at
       FROM sponsors s
       JOIN users u ON u.id = s.user_id
      WHERE s.enterprise_id = $1
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
export async function listUserEnterprises(userId: number) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM enterprises
      WHERE id IN (SELECT enterprise_id FROM sponsors WHERE user_id = $1)
      ORDER BY name`,
    [userId],
  );
  return rows;
}

/** Affiliate a user with an enterprise. Idempotent-safe: 409 if already linked. */
export async function addEnterpriseMember(
  enterpriseId: number,
  userId: number,
  actorId: number | null,
): Promise<EnterpriseMember> {
  await getEnterprise(enterpriseId); // 404 if the enterprise is missing
  const { rows: userRows } = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!userRows[0]) throw new NotFoundError("User not found", { userId });

  const { rows: existing } = await pool.query(
    `SELECT id FROM sponsors WHERE enterprise_id = $1 AND user_id = $2`,
    [enterpriseId, userId],
  );
  if (existing[0]) {
    throw new ConflictError("User is already affiliated with this enterprise", {
      enterpriseId,
      userId,
    });
  }
  const { member, user } = await withTransaction(async (client) => {
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
    const { rows: users } = await client.query(`SELECT name, email FROM users WHERE id = $1`, [
      userId,
    ]);
    return { member: rows[0], user: users[0] };
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
  const { rowCount } = await pool.query(
    `DELETE FROM sponsors WHERE enterprise_id = $1 AND user_id = $2`,
    [enterpriseId, userId],
  );
  if (!rowCount) {
    throw new NotFoundError("User is not affiliated with this enterprise", {
      enterpriseId,
      userId,
    });
  }
  await audit(pool, {
    actorId,
    entityType: "enterprise",
    entityId: enterpriseId,
    action: "member_removed",
    after: { userId },
  });
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
