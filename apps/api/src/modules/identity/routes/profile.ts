import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  getEffectiveCapabilities,
  invalidateCapabilities,
  requireAuth,
  requireCapability,
} from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
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
            // Effective capabilities (H8) so the web/mobile UI can gate by
            // capability, never by the illustrative role (H55). Authoritative
            // enforcement still happens on every guarded route server-side.
            capabilities: z.array(z.string()),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const row = await fetchUser(userId);
      const [role, capabilities] = await Promise.all([
        computeDerivedRole(pool, userId),
        getEffectiveCapabilities(userId),
      ]);
      return { ...serializeUser(row), role, capabilities: [...capabilities] };
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
    "/api/users",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        querystring: z.object({
          q: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            users: z.array(
              z.object({
                id: z.number(),
                email: z.string(),
                emailVerified: z.boolean(),
                name: z.string().nullable(),
                surname: z.string().nullable(),
                badgeId: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            total: z.number(),
          }),
        },
      },
    },
    async (req) => {
      // H8/H10: staff directory. `q` matches name/surname/email (ILIKE).
      const { q, limit, offset } = req.query;
      const filter = q?.trim() ? `%${q.trim()}%` : null;
      const where = filter ? `WHERE name ILIKE $1 OR surname ILIKE $1 OR email ILIKE $1` : "";
      const args = filter ? [filter, limit, offset] : [limit, offset];
      const p = filter ? 2 : 1;
      const { rows } = await pool.query(
        `SELECT id, email, email_verified, name, surname, badge_id, created_at
           FROM users ${where}
           ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        args,
      );
      const { rows: countRows } = await pool.query(
        `SELECT count(*)::int AS n FROM users ${where}`,
        filter ? [filter] : [],
      );
      return {
        users: rows.map((r: UserRow) => ({
          id: r.id,
          email: r.email,
          emailVerified: r.email_verified,
          name: r.name,
          surname: r.surname,
          badgeId: r.badge_id,
          createdAt: r.created_at.toISOString(),
        })),
        total: countRows[0].n as number,
      };
    },
  );

  api.get(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: {
          200: userResponseSchema.extend({
            role: z.enum(["admin", "judge", "sponsor", "staff", "participant"]),
            capabilities: z.array(z.string()),
            groups: z.array(z.object({ id: z.number(), name: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      const row = await fetchUser(req.params.id);
      const [role, capabilities, groups] = await Promise.all([
        computeDerivedRole(pool, req.params.id),
        getEffectiveCapabilities(req.params.id),
        pool
          .query(
            `SELECT g.id, g.name FROM permission_group_members m
               JOIN permission_groups g ON g.id = m.group_id
              WHERE m.user_id = $1 ORDER BY g.name`,
            [req.params.id],
          )
          .then((r) => r.rows as { id: number; name: string }[]),
      ]);
      return { ...serializeUser(row), role, capabilities: [...capabilities], groups };
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

  // Hard-delete an account — superadmin only (ADMIN_ALL). Most references to
  // users have no ON DELETE CASCADE (audit trail, scans, evaluations…), so a
  // user who has *done* anything cannot be hard-deleted without corrupting
  // history: we surface a clear 409 in that case (H54 anonymization is the
  // proper path for those). Fresh/inactive accounts delete cleanly (sessions,
  // accounts and group memberships cascade).
  api.delete(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.ADMIN_ALL),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      const targetId = req.params.id;
      if (targetId === req.userId) {
        throw new BadRequestError("You can't delete your own account");
      }
      const target = await fetchUser(targetId);
      try {
        await withTransaction(async (client) => {
          await audit(client, {
            actorId: req.userId,
            entityType: "user",
            entityId: targetId,
            action: "delete",
            source: "admin",
            before: { email: target.email },
          });
          await client.query(`DELETE FROM users WHERE id = $1`, [targetId]);
        });
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "23503"
        ) {
          throw new ConflictError(
            "This account has activity (audit, scans, evaluations…) and can't be hard-deleted. Anonymize its personal data instead.",
            { userId: targetId },
          );
        }
        throw err;
      }
      await invalidateCapabilities(targetId);
      return { deleted: true as const };
    },
  );

  // A user's physical history (H24-H26): activity/meal passes, badge check-ins
  // and door in/out scans — what the profile's "Activity" tab shows. Meals are
  // activities (activity.category = 'meal'), so a repeated meal shows as
  // multiple passes. Staff read (USERS_READ).
  api.get(
    "/api/users/:id/activity",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: {
          200: z.object({
            passes: z.array(
              z.object({
                id: z.number(),
                activityName: z.string(),
                category: z.string(),
                loggedAt: z.string(),
                notes: z.string().nullable(),
              }),
            ),
            checkIns: z.array(
              z.object({
                id: z.number(),
                badgeId: z.string().nullable(),
                method: z.string(),
                checkedInAt: z.string(),
              }),
            ),
            doorScans: z.array(
              z.object({
                id: z.number(),
                kind: z.string(),
                location: z.string().nullable(),
                scannedAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const id = req.params.id;
      await fetchUser(id); // 404 if the user doesn't exist
      const [passes, checkIns, doorScans] = await Promise.all([
        pool
          .query(
            `SELECT al.id, a.name AS activity_name, a.category, al.logged_at, al.notes
               FROM activity_logs al JOIN activities a ON a.id = al.activity_id
              WHERE al.user_id = $1 ORDER BY al.logged_at DESC LIMIT 500`,
            [id],
          )
          .then((r) =>
            r.rows.map(
              (x: {
                id: number;
                activity_name: string;
                category: string;
                logged_at: Date;
                notes: string | null;
              }) => ({
                id: x.id,
                activityName: x.activity_name,
                category: x.category,
                loggedAt: x.logged_at.toISOString(),
                notes: x.notes,
              }),
            ),
          ),
        pool
          .query(
            `SELECT id, badge_id, check_in_method, checked_in_at
               FROM check_in_logs WHERE user_id = $1 ORDER BY checked_in_at DESC LIMIT 200`,
            [id],
          )
          .then((r) =>
            r.rows.map(
              (x: {
                id: number;
                badge_id: string | null;
                check_in_method: string;
                checked_in_at: Date;
              }) => ({
                id: x.id,
                badgeId: x.badge_id,
                method: x.check_in_method,
                checkedInAt: x.checked_in_at.toISOString(),
              }),
            ),
          ),
        pool
          .query(
            `SELECT id, kind, location, scanned_at
               FROM time_logs WHERE user_id = $1 ORDER BY scanned_at DESC LIMIT 200`,
            [id],
          )
          .then((r) =>
            r.rows.map(
              (x: { id: number; kind: string; location: string | null; scanned_at: Date }) => ({
                id: x.id,
                kind: x.kind,
                location: x.location,
                scannedAt: x.scanned_at.toISOString(),
              }),
            ),
          ),
      ]);
      return { passes, checkIns, doorScans };
    },
  );
}
