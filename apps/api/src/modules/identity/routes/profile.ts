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
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { issueTicket } from "../../logistics/tickets.js";
import { reconcileDevpostParticipantsForUser } from "../../projects/reconciliation.js";
import { canCreateMyProject, hasMyProject, myProjects } from "../../projects/service.js";
import { hasMyQueueItems } from "../../queue/reads.js";
import { anonymizeUser } from "../anonymize.js";
import { hasMobileAccess } from "../mobile-access.js";
import {
  assertActiveWildcardHolder,
  lockPermissionGraph,
  userHasWildcard,
} from "../permission-graph.js";
import { clearOwnUnretainedReferences, getAccountRemovalEligibility } from "../removal.js";
import { computeDerivedRole, computeMembershipFlags, hasEventAccess } from "../role.js";

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
const DIETARY_DATA_STATES = ["not_provided", "present"] as const;

const derivedRoleSchema = z.enum([
  "admin",
  "judge",
  "sponsor",
  "staff",
  "mentor",
  "participant",
  "unassigned",
]);

/** Fields a user may edit on themself (H7: "consultar mis datos… y si detecto un error"). */
const selfPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    surname: z.string().min(1).max(200).optional(),
    language: z.enum(LANGUAGES).optional(),
    image: z.string().max(2000).nullable().optional(),
    universityId: z.number().int().nullable().optional(),
    // Logistics data a participant owns and manages on their own settings page.
    foodIntolerances: z.array(z.number().int()).optional(),
    foodIntoleranceNotes: z.string().max(2000).nullable().optional(),
    shirtSize: z.string().max(10).nullable().optional(),
  })
  .strict();

/** Staff (USERS_WRITE) can additionally fix identity-critical fields. */
const staffPatchSchema = selfPatchSchema
  .extend({
    dni: z.string().max(50).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

const attendeeRoleBody = z.object({ role: z.enum(["participant", "mentor"]) }).strict();

const COLUMN_BY_FIELD: Record<string, string> = {
  name: "name",
  surname: "surname",
  language: "language",
  image: "image",
  foodIntolerances: "food_intolerances",
  foodIntoleranceNotes: "food_intolerance_notes",
  shirtSize: "shirt_size",
  universityId: "university_id",
  dni: "dni",
  notes: "notes",
};

const removalEligibilityResponseSchema = z.object({
  action: z.enum(["delete", "anonymize"]),
  reasonCode: z.enum(["fresh_account", "operational_history"]),
  accessRevoked: z.literal(true),
  operationalHistoryRetained: z.boolean(),
});

const userResponseSchema = z.object({
  id: z.number(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string().nullable(),
  surname: z.string().nullable(),
  image: z.string().nullable(),
  dni: z.string().nullable(),
  badgeId: z.string().nullable(),
  language: z.string(),
  secondaryEmail: z.string().nullable(),
  secondaryEmailVerified: z.boolean(),
  foodIntolerances: z.array(z.number()),
  foodIntoleranceNotes: z.string().nullable(),
  dietaryDataState: z.enum(DIETARY_DATA_STATES),
  shirtSize: z.string().nullable(),
  universityId: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const userProjectSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  github_url: z.string().nullable(),
  devpost_url: z.string().nullable(),
  demo_url: z.string().nullable(),
  prizes: z.array(z.string()),
  challenges: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
    }),
  ),
});

interface UserRow {
  id: number;
  email: string;
  email_verified: boolean;
  name: string | null;
  surname: string | null;
  image: string | null;
  dni: string | null;
  badge_id: string | null;
  language: string;
  secondary_email: string | null;
  secondary_email_verified_at: Date | null;
  food_intolerances: number[];
  food_intolerance_notes: string | null;
  dietary_data_state: (typeof DIETARY_DATA_STATES)[number];
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
    image: row.image,
    dni: row.dni,
    badgeId: row.badge_id,
    language: row.language,
    secondaryEmail: row.secondary_email,
    secondaryEmailVerified: row.secondary_email_verified_at !== null,
    foodIntolerances: row.food_intolerances,
    foodIntoleranceNotes: row.food_intolerance_notes,
    dietaryDataState: row.dietary_data_state,
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
    let { rows: afterRows } = await client.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (
      entries.some(([field]) => field === "foodIntolerances" || field === "foodIntoleranceNotes")
    ) {
      ({ rows: afterRows } = await client.query(
        `UPDATE users
            SET dietary_data_state = CASE
                  WHEN cardinality(food_intolerances) > 0
                    OR NULLIF(BTRIM(food_intolerance_notes), '') IS NOT NULL
                  THEN 'present'
                  ELSE 'not_provided'
                END
          WHERE id = $1
          RETURNING *`,
        [targetId],
      ));
    }
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
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        description:
          "The caller's own profile, illustrative role, effective capabilities (H8), " +
          "the isRoomJudge/isSponsorRep association facts nav uses for multi-capability " +
          "accounts (H55), whether they currently hold event access (confirmed spot or " +
          "manual attendee role), whether they have a project/queue entry of their own " +
          "(drives hiding the My project/My queue nav items, issue #424), and mobile " +
          "access eligibility.",
        summary: "Get my profile",
        response: {
          200: userResponseSchema.extend({
            role: derivedRoleSchema,
            mobileAccess: z.boolean(),
            // Effective capabilities (H8) so the web/mobile UI can gate by
            // capability, never by the illustrative role (H55). Authoritative
            // enforcement still happens on every guarded route server-side.
            capabilities: z.array(z.string()),
            // Additive association facts (H55): a multi-capability account
            // (e.g. sponsor rep + room judge) needs both workspaces, which
            // the single-priority `role` above can't represent on its own.
            isRoomJudge: z.boolean(),
            isSponsorRep: z.boolean(),
            // Confirmed spot or manual attendee role — drives ticket/wallet
            // exposure and hides participant-only nav for pure applicants.
            hasEventAccess: z.boolean(),
            // issue #424: My project/My queue nav items are hidden until the
            // caller actually has one — visible-but-empty misleads sponsors
            // and participants who hold the capability but nothing to show.
            hasProject: z.boolean(),
            hasQueueItems: z.boolean(),
            // My project stays visible without a project yet when H19
            // self-creation is currently open to this caller — otherwise
            // hiding it would remove their only entry point to create one.
            canCreateProject: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const row = await fetchUser(userId);
      const [
        role,
        capabilities,
        membership,
        eventAccess,
        hasProject,
        hasQueueItems,
        canCreateProject,
      ] = await Promise.all([
        computeDerivedRole(pool, userId),
        getEffectiveCapabilities(userId),
        computeMembershipFlags(pool, userId),
        hasEventAccess(pool, userId),
        hasMyProject(userId),
        hasMyQueueItems(userId),
        canCreateMyProject(userId),
      ]);
      const mobileAccess = await hasMobileAccess(pool, userId, role);
      return {
        ...serializeUser(row),
        role,
        mobileAccess,
        capabilities: [...capabilities],
        ...membership,
        hasEventAccess: eventAccess,
        hasProject,
        hasQueueItems,
        canCreateProject,
      };
    },
  );

  api.patch(
    "/api/me",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        body: selfPatchSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      // M1.5: once any application has been accepted, the participant can no
      // longer CHANGE their own legal name (it's on their badge/certificate).
      // We compare against the stored values so an unchanged name/surname
      // (the settings form always submits them) doesn't block edits to other
      // fields like shirt size or dietary info. Staff can still fix names via
      // PATCH /api/users/:id. Locked statuses: internally accepted, sent, confirmed.
      if (req.body.name !== undefined || req.body.surname !== undefined) {
        const { rows: cur } = await pool.query(`SELECT name, surname FROM users WHERE id = $1`, [
          userId,
        ]);
        const changingName = req.body.name !== undefined && req.body.name !== cur[0]?.name;
        const changingSurname =
          req.body.surname !== undefined && req.body.surname !== cur[0]?.surname;
        if (changingName || changingSurname) {
          const { rows } = await pool.query(
            `SELECT 1 FROM application_responses
               WHERE user_id = $1
                 AND status IN ('accepted_internal', 'accepted', 'confirmed')
               LIMIT 1`,
            [userId],
          );
          if (rows.length > 0) {
            throw new ConflictError(
              "Your name is locked because an application has been accepted — ask staff to change it.",
              { code: "name_locked" },
            );
          }
        }
      }
      const after = await applyUserPatch(userId, userId, req.body, "web");
      return serializeUser(after);
    },
  );

  api.get(
    "/api/me/removal-eligibility",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        description:
          "H54 self-service preflight: whether the caller can delete their own account outright, " +
          "or whether it can only be anonymized on request (retained history) — never both.",
        summary: "Get my account-removal eligibility",
        response: { 200: removalEligibilityResponseSchema },
      },
    },
    async (req) => getAccountRemovalEligibility(pool, req.userId as number),
  );

  // Self-service deletion (H54) — a participant who was never accepted/given
  // a role has no operational history worth retaining, so they can delete
  // their own account outright (danger-zone UI). Anyone with retained history
  // (ticket, scans, submissions…) can't self-serve: only an admin can
  // anonymize on request (privacy policy §6) — this route 409s for them.
  api.delete(
    "/api/me",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        description:
          "H54 self-service account deletion. Only allowed when the account has no retained " +
          "operational history; otherwise 409 — the privacy policy points accredited " +
          "participants to requesting anonymization from an administrator instead.",
        summary: "Delete my account",
        response: { 200: z.object({ deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const eligibility = await getAccountRemovalEligibility(pool, userId);
      if (eligibility.action === "anonymize") {
        throw new ConflictError(
          "This account has retained history and can't self-delete — request anonymization from an administrator instead.",
          { userId, reasonCode: eligibility.reasonCode },
        );
      }
      try {
        await withTransaction(async (client) => {
          await lockPermissionGraph(client);
          const wasWildcardHolder = await userHasWildcard(client, userId);
          const target = await fetchUser(userId);
          // actorId: null — actor and target are the same row, which is
          // about to be deleted in this transaction; audit_log.actor_id
          // references users(id), so pointing it at the row being removed
          // would self-block the DELETE below with a FK violation.
          await audit(client, {
            actorId: null,
            entityType: "user",
            entityId: userId,
            action: "delete",
            source: "web",
            before: { email: target.email },
          });
          await clearOwnUnretainedReferences(client, userId);
          await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
          if (wasWildcardHolder) await assertActiveWildcardHolder(client);
        });
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "23503"
        ) {
          throw new ConflictError(
            "This account has retained history and can't self-delete — request anonymization from an administrator instead.",
            { userId },
          );
        }
        throw err;
      }
      await invalidateCapabilities(userId);
      return { deleted: true as const };
    },
  );

  api.get(
    "/api/users",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
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
                role: derivedRoleSchema,
                language: z.string(),
                shirtSize: z.string().nullable(),
                applicationStatus: z.string().nullable(),
                confirmedSpot: z.boolean(),
                createdAt: z.string(),
              }),
            ),
            total: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const { q, limit, offset } = req.query;
      const filter = q?.trim() ? `%${q.trim()}%` : null;
      const where = filter ? `WHERE name ILIKE $1 OR surname ILIKE $1 OR email ILIKE $1` : "";
      const args = filter ? [filter, limit, offset] : [limit, offset];
      const p = filter ? 2 : 1;
      const { rows } = await pool.query(
        `SELECT id, email, email_verified, name, surname, badge_id, language, shirt_size, created_at
           FROM users ${where}
           ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        args,
      );
      const { rows: countRows } = await pool.query(
        `SELECT count(*)::int AS n FROM users ${where}`,
        filter ? [filter] : [],
      );
      const ids = rows.map((r: UserRow) => r.id);
      const { rows: statusRows } =
        ids.length > 0
          ? await pool.query(
              `SELECT DISTINCT ON (user_id) user_id, status
                 FROM application_responses
                WHERE user_id = ANY($1::int[])
                ORDER BY user_id,
                  CASE status
                    WHEN 'confirmed' THEN 1
                    WHEN 'accepted' THEN 2
                    WHEN 'accepted_internal' THEN 3
                    WHEN 'declined' THEN 4
                    WHEN 'expired' THEN 5
                    WHEN 'rejected' THEN 6
                    WHEN 'rejected_internal' THEN 7
                    WHEN 'review' THEN 8
                    WHEN 'submitted' THEN 9
                    ELSE 10
                  END,
                  id DESC`,
              [ids],
            )
          : { rows: [] };
      const statusByUser = new Map(
        statusRows.map((r: { user_id: number; status: string }) => [r.user_id, r.status]),
      );

      const users = await Promise.all(
        rows.map(async (r: UserRow) => ({
          id: r.id,
          email: r.email,
          emailVerified: r.email_verified,
          name: r.name,
          surname: r.surname,
          badgeId: r.badge_id,
          role: await computeDerivedRole(pool, r.id),
          language: r.language,
          shirtSize: r.shirt_size,
          applicationStatus: statusByUser.get(r.id) ?? null,
          confirmedSpot: statusByUser.get(r.id) === "confirmed",
          createdAt: r.created_at.toISOString(),
        })),
      );

      return {
        users,
        total: countRows[0].n as number,
      };
    },
  );

  api.get(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: {
          200: userResponseSchema.extend({
            role: derivedRoleSchema,
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

  api.get(
    "/api/users/:id/projects",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ projects: z.array(userProjectSchema) }) },
      },
    },
    async (req) => {
      await fetchUser(req.params.id);
      return { projects: await myProjects(req.params.id) };
    },
  );

  api.patch(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_WRITE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_WRITE }),
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

  api.put(
    "/api/users/:id/attendee-role",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_WRITE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_WRITE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        body: attendeeRoleBody,
        summary: "Set an attendee type manually",
        description:
          "Classify an attendee as participant or mentor through an auditable relationship, never a permission role. The permanent ticket is issued in the same transaction.",
        response: {
          200: z.object({ role: z.enum(["participant", "mentor"]), ticketIssued: z.literal(true) }),
        },
      },
    },
    async (req) =>
      withTransaction(async (client) => {
        const { rows } = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
          req.params.id,
        ]);
        if (!rows[0]) throw new NotFoundError("User not found", { userId: req.params.id });
        await client.query(
          `INSERT INTO manual_attendee_roles (user_id, role, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE
             SET role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by, assigned_at = now()`,
          [req.params.id, req.body.role, req.userId],
        );
        await issueTicket(client, req.params.id);
        await audit(client, {
          actorId: req.userId,
          entityType: "user",
          entityId: req.params.id,
          action: "attendee_role_set",
          source: "admin",
          after: { role: req.body.role },
        });
        return { role: req.body.role, ticketIssued: true as const };
      }),
  );

  api.get(
    "/api/users/:id/removal-eligibility",
    {
      preHandler: requireCapability(CAPABILITIES.ADMIN_ALL),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        description:
          "Read-only H54 preflight selecting the one safe account-removal action from retained references.",
        summary: "Get account-removal eligibility",
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: removalEligibilityResponseSchema },
      },
    },
    async (req) => {
      const targetId = req.params.id;
      if (targetId === req.userId) {
        throw new BadRequestError("You can't remove your own account");
      }
      await fetchUser(targetId);
      return getAccountRemovalEligibility(pool, targetId);
    },
  );

  // Hard-delete an account — superadmin only (ADMIN_ALL). Most references to
  // users have no ON DELETE CASCADE (audit trail, scans, evaluations…), so a
  // user who has *done* anything cannot be hard-deleted without corrupting
  // history: we surface a clear 409 in that case (H54 anonymization is the
  // proper path for those). Fresh/inactive accounts delete cleanly (sessions,
  // accounts and group memberships cascade); an unaccepted applicant with no
  // ticket/role also deletes cleanly — clearOwnUnretainedReferences removes
  // their own application_responses/applicant_reviews and account-claim
  // token, since none of that is operational history worth retaining (H54).
  api.delete(
    "/api/users/:id",
    {
      preHandler: requireCapability(CAPABILITIES.ADMIN_ALL),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
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
      const eligibility = await getAccountRemovalEligibility(pool, targetId);
      if (eligibility.action === "anonymize") {
        throw new ConflictError(
          "This account has activity (audit, scans, evaluations…) and can't be hard-deleted. Anonymize its personal data instead.",
          { userId: targetId, reasonCode: eligibility.reasonCode },
        );
      }
      try {
        await withTransaction(async (client) => {
          await lockPermissionGraph(client);
          const wasWildcardHolder = await userHasWildcard(client, targetId);
          await audit(client, {
            actorId: req.userId,
            entityType: "user",
            entityId: targetId,
            action: "delete",
            source: "admin",
            before: { email: target.email },
          });
          await clearOwnUnretainedReferences(client, targetId);
          await client.query(`DELETE FROM users WHERE id = $1`, [targetId]);
          if (wasWildcardHolder) await assertActiveWildcardHolder(client);
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

  // Change a user's PRIMARY email — staff utility (USERS_WRITE). `users.email`
  // is a plain UNIQUE column, NOT a foreign key target: credential login keys
  // the accounts row on user_id (accounts.account_id is the user id as text),
  // and sessions/accounts reference users(id). So this is a single-column
  // update — no cascading FK work — guarded only by the uniqueness rules that
  // also protect secondary emails (H6): the address may not already be another
  // account's primary, nor another account's VERIFIED secondary. Audited (H53).
  api.patch(
    "/api/users/:id/email",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_WRITE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_WRITE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        body: z.object({ email: z.string().email() }).strict(),
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const targetId = req.params.id;
      const email = req.body.email.trim().toLowerCase();
      const after = await withTransaction(async (client) => {
        const { rows: beforeRows } = await client.query(
          `SELECT * FROM users WHERE id = $1 FOR UPDATE`,
          [targetId],
        );
        if (!beforeRows[0]) throw new NotFoundError("User not found", { userId: targetId });
        const before = beforeRows[0] as UserRow;
        if (before.email === email) return before; // idempotent no-op

        const { rows: primaryClash } = await client.query(
          `SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1`,
          [email, targetId],
        );
        if (primaryClash.length > 0) {
          throw new ConflictError("That email already belongs to another account", { email });
        }
        const { rows: secondaryClash } = await client.query(
          `SELECT id FROM users
             WHERE secondary_email = $1 AND secondary_email_verified_at IS NOT NULL AND id <> $2
             LIMIT 1`,
          [email, targetId],
        );
        if (secondaryClash.length > 0) {
          throw new ConflictError("That email is another account's verified secondary email", {
            email,
          });
        }

        // The admin is asserting the corrected address, so it counts as verified
        // (mirrors how staff-set contact data is trusted elsewhere in H7).
        const { rows: afterRows } = await client.query(
          `UPDATE users SET email = $2, email_verified = true WHERE id = $1 RETURNING *`,
          [targetId, email],
        );
        await reconcileDevpostParticipantsForUser(client, targetId);
        await audit(client, {
          actorId: req.userId,
          entityType: "user",
          entityId: targetId,
          action: "primary_email_changed",
          source: "admin",
          before: { email: before.email },
          after: { email },
        });
        return afterRows[0] as UserRow;
      });
      return serializeUser(after);
    },
  );

  // Anonymize an account — H54 "borrado de datos personales". This is the path
  // the DELETE 409 above points to: accounts that have done things (audit,
  // scans, evaluations…) can't be hard-deleted without corrupting history, so
  // instead we scrub every PII column in place (keeping the row + its FK
  // references intact) and revoke all access (sessions + credential accounts).
  // Superadmin only (ADMIN_ALL); irreversible; audited (H53).
  api.post(
    "/api/users/:id/anonymize",
    {
      preHandler: requireCapability(CAPABILITIES.ADMIN_ALL),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ anonymized: z.literal(true) }) },
      },
    },
    async (req) => {
      const targetId = req.params.id;
      await withTransaction((client) =>
        anonymizeUser(client, { targetId, actorId: req.userId, source: "admin" }),
      );
      await invalidateCapabilities(targetId);
      return { anonymized: true as const };
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
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
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

  // A user's application responses (D): what the admin panel's "Applications" tab
  // shows. Returns the same shape as the response-detail endpoint but scoped to
  // one user, without food/shirt data (those go on the general profile tab).
  api.get(
    "/api/users/:id/responses",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: {
          200: z.object({
            responses: z.array(
              z.object({
                id: z.number(),
                applicationId: z.number(),
                applicationName: z.string(),
                applicationType: z.string(),
                status: z.string(),
                submittedAt: z.string().nullable(),
                confirmedAt: z.string().nullable(),
                declinedAt: z.string().nullable(),
                responses: z.record(z.string(), z.unknown()),
                staffNotes: z.string().nullable(),
                reviews: z.array(
                  z.object({
                    authorId: z.number(),
                    score: z.number().nullable(),
                    notes: z.string().nullable(),
                  }),
                ),
                availableActions: z.array(z.string()),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.params.id;
      // Verify user exists
      await fetchUser(userId);

      const { rows: responseRows } = await pool.query(
        `SELECT r.*, a.name AS app_name, a.type AS app_type
         FROM application_responses r
         JOIN applications a ON a.id = r.application_id
         WHERE r.user_id = $1
         ORDER BY r.id DESC`,
        [userId],
      );

      const responses = await Promise.all(
        responseRows.map(async (row: Record<string, unknown>) => {
          const { rows: reviews } = await pool.query(
            `SELECT author_id, score, notes FROM applicant_reviews WHERE response_id = $1 ORDER BY author_id`,
            [row.id],
          );
          return {
            id: row.id as number,
            applicationId: row.application_id as number,
            applicationName: row.app_name as string,
            applicationType: row.app_type as string,
            status: row.status as string,
            submittedAt: row.submitted_at ? (row.submitted_at as Date).toISOString() : null,
            confirmedAt: row.confirmed_at ? (row.confirmed_at as Date).toISOString() : null,
            declinedAt: row.declined_at ? (row.declined_at as Date).toISOString() : null,
            responses: row.responses as Record<string, unknown>,
            staffNotes: (row.staff_notes as string | null) ?? null,
            reviews: reviews.map(
              (r: { author_id: number; score: number | null; notes: string | null }) => ({
                authorId: r.author_id,
                score: r.score,
                notes: r.notes,
              }),
            ),
            availableActions: computeAvailableActions(row.status as string),
          };
        }),
      );

      return { responses };
    },
  );
}

// Compute available staff actions for a response based on its status.
// Duplicated from applications/service.ts to avoid cross-module import of a
// pure function. Only USERS_READ-visible; the action names align with the
// admin panel's button rendering logic.
function computeAvailableActions(status: string): string[] {
  const actions: string[] = ["staff-notes"];
  switch (status) {
    case "submitted":
    case "review":
      actions.push("my-review");
      break;
    case "accepted_internal":
    case "rejected_internal":
      actions.push("decide", "revert-decision", "send-decision");
      break;
    case "accepted":
      actions.push("resend-decision", "revert-decision", "confirm-link", "decline-override");
      break;
    case "rejected":
      actions.push("re-accept", "resend-decision", "revert-decision");
      break;
    case "confirmed":
      actions.push("decline-override");
      break;
    case "declined":
    case "expired":
      actions.push("re-accept");
      break;
  }
  return actions;
}
