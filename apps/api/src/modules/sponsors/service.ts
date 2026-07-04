import { pool, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import type { CreateEnterpriseBody, UpdateEnterpriseBody } from "./schemas.js";

const COLUMNS = `id, name, website, logo_url, description, tier_id,
  display_priority, visibility, available_from, director_id, created_at`;

const COLUMN_FOR: Record<string, string> = {
  name: "name",
  website: "website",
  logoUrl: "logo_url",
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
         (name, website, logo_url, description, tier_id, display_priority, visibility, available_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        input.name,
        input.website ?? null,
        input.logoUrl ?? null,
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

export async function setEnterpriseLogo(id: number, logoUrl: string, actorId: number | null) {
  const { rows } = await pool.query(
    `UPDATE enterprises SET logo_url = $1 WHERE id = $2 RETURNING ${COLUMNS}`,
    [logoUrl, id],
  );
  if (!rows[0]) throw new NotFoundError("Enterprise not found", { id });
  await audit(pool, {
    actorId,
    entityType: "enterprise",
    entityId: id,
    action: "logo_updated",
    after: { logoUrl },
  });
  return rows[0];
}

export interface PublicSponsor {
  enterpriseId: number;
  name: string;
  website: string | null;
  logoUrl: string | null;
  priority: number;
}

/**
 * Publicly-revealed sponsors for the website / TV logo grid (H45). Driven by
 * the enterprise's own visibility + scheduled reveal — independent of whether
 * it owns a published challenge. Ordered by display priority (1 = primary /
 * biggest), falling back to the sponsor tier's logo_priority.
 */
export async function listPublicSponsors(client: Queryable = pool): Promise<PublicSponsor[]> {
  const { rows } = await client.query(
    `SELECT e.id AS enterprise_id, e.name, e.website, e.logo_url,
            COALESCE(e.display_priority, st.logo_priority, 9999) AS priority
       FROM enterprises e
       LEFT JOIN sponsor_tiers st ON st.id = e.tier_id
      WHERE e.visibility = 'visible'
        AND (e.available_from IS NULL OR e.available_from <= now())
      ORDER BY priority ASC, e.name ASC`,
  );
  return rows.map((r: Record<string, unknown>) => ({
    enterpriseId: Number(r.enterprise_id),
    name: String(r.name),
    website: (r.website as string | null) ?? null,
    logoUrl: (r.logo_url as string | null) ?? null,
    priority: Number(r.priority),
  }));
}
