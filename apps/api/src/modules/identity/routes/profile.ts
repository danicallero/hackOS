import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireAuth, requireCapability } from "../../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../../lib/errors.js";
import { computeDerivedRole } from "../role.js";

/**
 * Profile routes (H7).
 * - GET /api/me           — own data + derived illustrative role
 * - PATCH /api/me         — own data, RESTRICTED fields only (contact info,
 *   language, food intolerances, shirt size). Email, verification flags,
 *   badge, dni and notes are staff-only or system-only.
 * - GET /api/users/:id    — staff, USERS_READ
 * - PATCH /api/users/:id  — staff, USERS_WRITE; wider field set; audited.
 */

const LANGUAGES = ["en", "es", "gl"] as const;

/** Fields a user may edit on themself (H7: "consultar mis datos… y si detecto un error"). */
const selfPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    surname: z.string().min(1).max(200).optional(),
    phone: z.string().max(50).nullable().optional(),
    language: z.enum(LANGUAGES).optional(),
    image: z.string().max(2000).nullable().optional(),
    foodIntolerances: z.array(z.number().int()).optional(),
    foodIntoleranceNotes: z.string().max(2000).nullable().optional(),
    shirtSize: z.string().max(10).nullable().optional(),
    universityId: z.number().int().nullable().optional(),
  })
  .strict();

/** Staff (USERS_WRITE) can additionally fix identity-critical fields. */
const staffPatchSchema = selfPatchSchema
  .extend({
    dni: z.string().max(50).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

const COLUMN_BY_FIELD: Record<string, string> = {
  name: "name",
  surname: "surname",
  phone: "phone",
  language: "language",
  image: "image",
  foodIntolerances: "food_intolerances",
  foodIntoleranceNotes: "food_intolerance_notes",
  shirtSize: "shirt_size",
  universityId: "university_id",
  dni: "dni",
  notes: "notes",
};

const userResponseSchema = z.object({
  id: z.number(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  surname: z.string().nullable(),
  phone: z.string().nullable(),
  image: z.string().nullable(),
  dni: z.string().nullable(),
  badgeId: z.string().nullable(),
  language: z.string(),
  secondaryEmail: z.string().nullable(),
  secondaryEmailVerified: z.boolean(),
  foodIntolerances: z.array(z.number()),
  foodIntoleranceNotes: z.string().nullable(),
  shirtSize: z.string().nullable(),
  universityId: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

interface UserRow {
  id: number;
  email: string;
  email_verified: boolean;
  name: string | null;
  surname: string | null;
  phone: string | null;
  image: string | null;
  dni: string | null;
  badge_id: string | null;
  language: string;
  secondary_email: string | null;
  secondary_email_verified_at: Date | null;
  food_intolerances: number[];
  food_intolerance_notes: string | null;
  shirt_size: string | null;
  university_id: number | null;
  notes: string | null;
  created_at: Date;
}

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    surname: row.surname,
    phone: row.phone,
    image: row.image,
    dni: row.dni,
    badgeId: row.badge_id,
    language: row.language,
    secondaryEmail: row.secondary_email,
    secondaryEmailVerified: row.secondary_email_verified_at !== null,
    foodIntolerances: row.food_intolerances,
    foodIntoleranceNotes: row.food_intolerance_notes,
    shirtSize: row.shirt_size,
    universityId: row.university_id,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

async function fetchUser(userId: number): Promise<UserRow> {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) throw new NotFoundError("User not found", { userId });
  return rows[0] as UserRow;
}

/** Applies a validated patch inside a transaction, auditing when actor != target. */
async function applyUserPatch(
  targetId: number,
  actorId: number,
  patch: Record<string, unknown>,
  source: string,
): Promise<UserRow> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new BadRequestError("Empty patch — nothing to update");

  return withTransaction(async (client) => {
    const { rows: beforeRows } = await client.query(
      `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
      [targetId],
    );
    if (!beforeRows[0]) throw new NotFoundError("User not found", { userId: targetId });
    const before = beforeRows[0] as UserRow;

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of entries) {
      const column = COLUMN_BY_FIELD[field];
      if (!column) throw new BadRequestError(`Unknown field: ${field}`);
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    values.push(targetId);
    const { rows: afterRows } = await client.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const after = afterRows[0] as UserRow;

    // H7/H53: audit staff edits of somebody else's profile. Self-edits of
    // benign fields don't need an audit row.
    if (actorId !== targetId) {
      const beforeAudit: Record<string, unknown> = {};
      const afterAudit: Record<string, unknown> = {};
      for (const [field] of entries) {
        const column = COLUMN_BY_FIELD[field];
        if (!column) continue;
        beforeAudit[column] = (before as unknown as Record<string, unknown>)[column];
        afterAudit[column] = (after as unknown as Record<string, unknown>)[column];
      }
      await audit(client, {
        actorId,
        entityType: "user",
        entityId: targetId,
        action: "profile_update",
        source,
        before: beforeAudit,
        after: afterAudit,
      });
    }
    return after;
  });
}

export function registerProfileRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/me",
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: userResponseSchema.extend({
            role: z.enum(["admin", "judge", "sponsor", "staff", "participant"]),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const row = await fetchUser(userId);
      const role = await computeDerivedRole(pool, userId);
      return { ...serializeUser(row), role };
    },
  );

  api.patch(
    "/api/me",
    {
      preHandler: requireAuth,
      schema: {
        body: selfPatchSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const after = await applyUserPatch(userId, userId, req.body, "web");
      return serializeUser(after);
    },
  );

  api.get(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const row = await fetchUser(req.params.id);
      return serializeUser(row);
    },
  );

  api.patch(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_WRITE),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        body: staffPatchSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const after = await applyUserPatch(req.params.id, req.userId as number, req.body, "admin");
      return serializeUser(after);
    },
  );
}
