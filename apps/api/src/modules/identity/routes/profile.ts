import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  assertActiveAuthenticatedUser,
  assertAuthenticatedProfileUser,
  getEffectiveCapabilities,
  invalidateCapabilities,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
import { idempotencyGuard, replayCompletedIdempotency } from "../../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { assertFixtureSubjectScope } from "../../logistics/review-fixture-scope.js";
import { issueTicket } from "../../logistics/tickets.js";
import { reconcileDevpostParticipantsForUser } from "../../projects/reconciliation.js";
import { canCreateMyProject, hasMyProject, myProjects } from "../../projects/service.js";
import { hasMyQueueItems } from "../../queue/reads.js";
import { getBetterAuthSessionToken } from "../auth.js";
import { hasMobileAccess } from "../mobile-access.js";
import {
  cancelPendingAccountRemoval,
  getAccountRemovalEligibility,
  getPendingAccountRemovalStatus,
  type PendingAccountRemovalStatus,
  runAccountRemoval,
} from "../removal.js";
import { issueRemovalPin } from "../removal-pin.js";
import {
  type AssignedRoleSummary,
  assignAttendeeRole,
  type BadgeCategory,
  computeMembershipFlags,
  getAssignedRoles,
  getBadgeCategory,
  getHighestVisibleRoleName,
  hasEventAccess,
} from "../role.js";
import { SUPERADMIN_ROLE_NAME } from "../role-authority.js";

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

/** H8: a user's complete assigned-role set, for a secondary "all roles" list next to the single displayed role. */
const assignedRoleSchema = z.object({
  id: z.number(),
  name: z.string(),
  position: z.number(),
  isVisible: z.boolean(),
});

const badgeCategorySchema = z.enum([
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
  reasonCode: z.enum([
    "fresh_account",
    "operational_history",
    "inconsistent_operational_reference",
  ]),
  accessRevoked: z.literal(true),
  operationalHistoryRetained: z.boolean(),
  activeEventConsequences: z.boolean(),
  requiresVenueExit: z.boolean(),
  integrityWarning: z.boolean(),
  securityPinRequired: z.boolean(),
  reauthenticationRequired: z.boolean(),
});

const removalCompletedResponseSchema = z.union([
  z.object({ status: z.literal("completed"), deleted: z.literal(true) }),
  z.object({ status: z.literal("completed"), anonymized: z.literal(true) }),
]);
const removalPendingResponseSchema = z.union([
  z.object({
    status: z.literal("pending_exit"),
    pendingExit: z.literal(true),
    accessRevoked: z.literal(true),
  }),
  z.object({ status: z.literal("processing"), accessRevoked: z.literal(true) }),
]);
const accountRemovalProfileStateSchema = z.union([
  z.object({
    status: z.literal("pending_exit"),
    action: z.literal("anonymize"),
    expiresAt: z.string(),
    canCancel: z.literal(true),
  }),
  z.object({
    status: z.literal("processing"),
    action: z.enum(["delete", "anonymize"]),
    expiresAt: z.string().nullable(),
    canCancel: z.literal(false),
  }),
]);
const accountRemovalStatusResponseSchema = z.union([
  z.object({ status: z.literal("active") }),
  accountRemovalProfileStateSchema,
]);
const removalPinResponseSchema = z.union([
  z.object({ status: z.literal("sent"), expiresAt: z.string() }),
  z.object({ status: z.literal("static") }),
  z.object({ status: z.literal("not_required") }),
]);
const optionalRemovalPinBodySchema = z
  .object({
    securityPin: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    reauthenticationPassword: z.string().min(1).max(128).optional(),
  })
  .strict()
  .nullable()
  .optional();

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
  accountState: z.enum(["active", "removal_pending"]),
  isTestAccount: z.boolean(),
  removal: accountRemovalProfileStateSchema.nullable(),
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
  account_state: "active" | "removal_pending";
  is_test_account: boolean;
  removal_action: "delete" | "anonymize" | null;
  removal_requires_exit: boolean;
  removal_expires_at: Date | null;
  created_at: Date;
}

function serializeUser(row: UserRow, removalStatus?: PendingAccountRemovalStatus) {
  const removal =
    removalStatus && removalStatus.status !== "active"
      ? removalStatus
      : row.account_state === "removal_pending"
        ? row.removal_action === "anonymize" && row.removal_requires_exit
          ? {
              status: "pending_exit" as const,
              action: "anonymize" as const,
              expiresAt: row.removal_expires_at?.toISOString() ?? new Date(0).toISOString(),
              canCancel: true as const,
            }
          : {
              status: "processing" as const,
              action: row.removal_action ?? "anonymize",
              expiresAt: row.removal_expires_at?.toISOString() ?? null,
              canCancel: false as const,
            }
        : null;
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
    accountState: row.account_state,
    isTestAccount: row.is_test_account,
    removal,
    createdAt: row.created_at.toISOString(),
  };
}

async function fetchUser(userId: number, allowPending = false): Promise<UserRow> {
  const { rows } = await pool.query(
    `SELECT * FROM users
      WHERE id = $1
        AND ${allowPending ? "account_state IN ('active', 'removal_pending')" : "account_state = 'active'"}
        AND anonymized_at IS NULL`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found", { userId });
  return rows[0] as UserRow;
}

/** Ordinary staff surfaces must not discover synthetic reviewer subjects. */
async function assertProfileSubjectScope(actorId: number, subjectId: number): Promise<void> {
  await assertFixtureSubjectScope(pool, actorId, subjectId);
}

/** Read the Better Auth session credential without logging or persisting it. */
async function sessionTokenFromRequest(req: FastifyRequest): Promise<string | null> {
  if (req.sessionToken) return req.sessionToken;
  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  return getBetterAuthSessionToken(headers);
}

// H7: once any application has been accepted, a participant can no longer
// self-edit identity/logistics fields (name, shirt size, dietary info) —
// they're on the badge/certificate and drive shirt orders/catering headcounts
// already committed to. Staff can still fix these via PATCH /api/users/:id.
async function hasAcceptedApplication(userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM application_responses
       WHERE user_id = $1
         AND status IN ('accepted_internal', 'accepted', 'confirmed')
       LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
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
      `SELECT * FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
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
  const selfRemovalPreHandler =
    (completionScope: string) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
        throw new BadRequestError("Idempotency-Key is required for account removal.", {
          code: "idempotency_key_required",
        });
      }
      // Use the identity-free completion scope from the first insert. The
      // request may revoke the session before Fastify's onSend hook runs; a
      // later storage failure must therefore be retryable under the same
      // scope, without leaving a stale user-scoped row behind.
      req.idempotencyScope = completionScope;
      if (await replayCompletedIdempotency(req, reply, completionScope)) return;
      await assertActiveAuthenticatedUser(req);
      await idempotencyGuard(req, reply);
      if (req.idempotency) req.idempotency.preserveOnFailure = true;
    };
  const selfRemovalCancellationPreHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const idempotencyKey = req.headers["idempotency-key"];
    // Keep cancellation replay rows user-scoped just like every other
    // mutation when a client supplies a key. The request may be retried after
    // the account returns to `active`, so the guard must replay before the
    // state check in the route. Keep the key optional for existing recovery
    // clients; keyed callers receive the stronger replay guarantee.
    if (typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0) {
      req.idempotencyScope = `POST /api/me/anonymize/cancel u:${req.userId ?? "anon"}`;
    }
    await assertAuthenticatedProfileUser(req);
    await idempotencyGuard(req, reply);
  };
  const adminRemovalIdempotency = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    // Keep target-bearing admin idempotency rows addressable for scrubbing.
    // The normal guard uses the route template for compatibility with other
    // mutations; these account-removal rows are deleted with the target.
    req.idempotencyScope = `${req.method} ${req.url} u:${req.userId ?? "anon"}`;
    await idempotencyGuard(req, reply);
  };

  api.get(
    "/api/me",
    {
      // A pending-exit account can sign in only to recover/cancel the
      // request or sign out. All event operations still require an active
      // account/capability; this route exposes the recovery state itself.
      preHandler: assertAuthenticatedProfileUser,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        description:
          "The caller's own profile, illustrative role, effective capabilities (H8), " +
          "the isEnterpriseJudge/isSponsorRep association facts nav uses for multi-capability " +
          "accounts (H55), whether they currently hold event access (confirmed spot or " +
          "manual attendee role), whether they have a project/queue entry of their own " +
          "(drives hiding the My project/My queue nav items, issue #424), mobile " +
          "access eligibility, and the caller's complete assigned-role set (H8) alongside " +
          "the single highest-visible `role` shown elsewhere.",
        summary: "Get my profile",
        response: {
          200: userResponseSchema.extend({
            role: badgeCategorySchema,
            // H8 full-replacement: the caller's actual highest-visible role
            // name (getEffectiveRole), alongside `role` (its fixed
            // badge/wallet/scanner category) — same pairing /api/users/:id
            // already exposes as visibleRoleName next to its own `role`.
            visibleRoleName: z.string().nullable(),
            mobileAccess: z.boolean(),
            // Effective capabilities (H8) so the web/mobile UI can gate by
            // capability, never by the illustrative role (H55). Authoritative
            // enforcement still happens on every guarded route server-side.
            capabilities: z.array(z.string()),
            // H8: the caller's FULL assigned-role set (highest position
            // first), additive next to `role` (the single highest-visible
            // one). Always the caller's own roles, so system:superadmin is
            // included when they actually hold it — nothing to hide from
            // yourself.
            roles: z.array(assignedRoleSchema),
            // Additive association facts (H55): a multi-capability account
            // (e.g. sponsor rep + enterprise judge) needs both workspaces, which
            // the single-priority `role` above can't represent on its own.
            isEnterpriseJudge: z.boolean(),
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
            // H7: once an application is accepted, name/shirt-size/dietary
            // fields are no longer self-editable — the web/mobile settings
            // form greys them out and points the participant at staff.
            profileLocked: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const row = await fetchUser(userId, true);
      const [
        role,
        capabilities,
        membership,
        eventAccess,
        hasProject,
        hasQueueItems,
        canCreateProject,
        profileLocked,
        removalStatus,
        roles,
      ] = await Promise.all([
        getBadgeCategory(pool, userId, req),
        getEffectiveCapabilities(userId, req),
        computeMembershipFlags(pool, userId),
        hasEventAccess(pool, userId),
        hasMyProject(userId),
        hasMyQueueItems(userId),
        canCreateMyProject(userId),
        hasAcceptedApplication(userId),
        getPendingAccountRemovalStatus(pool, userId),
        getAssignedRoles(pool, userId),
      ]);
      const mobileAccess =
        row.account_state === "active" && (await hasMobileAccess(pool, userId, role));
      return {
        ...serializeUser(row, removalStatus),
        role,
        visibleRoleName: roles.find((r) => r.isVisible)?.name ?? null,
        mobileAccess,
        capabilities: [...capabilities],
        roles,
        ...membership,
        hasEventAccess: eventAccess,
        hasProject,
        hasQueueItems,
        canCreateProject,
        profileLocked,
      };
    },
  );

  api.patch(
    "/api/me",
    {
      preHandler: requireAuth,
      // H1: account/profile setup is allowed before primary-email
      // verification; event transactions are guarded by the shared default.
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        body: selfPatchSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      // M1.5/H7: once any application has been accepted, the participant can
      // no longer CHANGE their own legal name (it's on their badge/certificate)
      // or their logistics data (shirt size, dietary info — already committed
      // to shirt orders/catering headcounts). We compare against the stored
      // values so an unchanged field (the settings form always submits them
      // all) doesn't block edits to fields that remain open, like language.
      // Staff can still fix these via PATCH /api/users/:id.
      const wantsIdentityChange = req.body.name !== undefined || req.body.surname !== undefined;
      const wantsLogisticsChange =
        req.body.shirtSize !== undefined ||
        req.body.foodIntolerances !== undefined ||
        req.body.foodIntoleranceNotes !== undefined;
      if (wantsIdentityChange || wantsLogisticsChange) {
        const { rows: cur } = await pool.query(
          `SELECT name, surname, shirt_size, food_intolerances, food_intolerance_notes
             FROM users WHERE id = $1`,
          [userId],
        );
        const changingName = req.body.name !== undefined && req.body.name !== cur[0]?.name;
        const changingSurname =
          req.body.surname !== undefined && req.body.surname !== cur[0]?.surname;
        const changingShirtSize =
          req.body.shirtSize !== undefined && req.body.shirtSize !== cur[0]?.shirt_size;
        const changingIntolerances =
          req.body.foodIntolerances !== undefined &&
          JSON.stringify([...req.body.foodIntolerances].sort()) !==
            JSON.stringify([...(cur[0]?.food_intolerances ?? [])].sort());
        const changingNotes =
          req.body.foodIntoleranceNotes !== undefined &&
          req.body.foodIntoleranceNotes !== cur[0]?.food_intolerance_notes;
        if (
          changingName ||
          changingSurname ||
          changingShirtSize ||
          changingIntolerances ||
          changingNotes
        ) {
          if (await hasAcceptedApplication(userId)) {
            throw new ConflictError(
              "Your profile is locked because an application has been accepted — ask staff to change your name, shirt size, or dietary info.",
              { code: "profile_locked" },
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

  api.get(
    "/api/me/removal-status",
    {
      preHandler: assertAuthenticatedProfileUser,
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Get my account-removal recovery status",
        description:
          "Returns the server-authoritative pending-exit state used by the login recovery surface. A pending request can be cancelled only before the exit or fixed recovery deadline.",
        response: { 200: accountRemovalStatusResponseSchema },
      },
    },
    async (req) => getPendingAccountRemovalStatus(pool, req.userId as number),
  );

  api.post(
    "/api/me/anonymize/cancel",
    {
      preHandler: selfRemovalCancellationPreHandler,
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Cancel my pending account anonymization",
        description:
          "Restores an in-venue anonymization request while its participant has not exited and its fixed recovery deadline has not passed.",
        response: { 200: z.object({ status: z.literal("cancelled") }) },
      },
    },
    async (req) =>
      withTransaction((client) =>
        cancelPendingAccountRemoval(client, req.userId as number, req.userId as number),
      ),
  );

  api.post(
    "/api/me/removal-pin",
    {
      preHandler: assertActiveAuthenticatedUser,
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Send my account-removal security PIN",
        description:
          "H54 sends a short-lived one-time PIN to a real verified primary email. Synthetic review fixtures may use the deployment's configured static review PIN; an unverified real account must re-enter its current password.",
        response: { 200: removalPinResponseSchema },
      },
    },
    async (req) => withTransaction((client) => issueRemovalPin(client, req.userId as number)),
  );

  // Self-service deletion (H54). The server chooses the mode from the locked
  // operational-history boundary; the mobile client never infers it from a
  // badge flag or cached profile. A fresh account is fully deleted.
  api.delete(
    "/api/me",
    {
      preHandler: selfRemovalPreHandler("DELETE /api/me removal-complete"),
      // Account removal is a security/privacy lifecycle action, not an event
      // transaction, so an unverified account may still use it (H1, H54) after
      // proving possession of its current credential.
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        description:
          "H54 self-service full deletion. The server chooses this only before canonical accreditation; an inconsistent open door record may wait for a valid exit. Unverified real accounts must re-enter their current password.",
        summary: "Delete my account",
        body: optionalRemovalPinBodySchema,
        response: { 200: removalCompletedResponseSchema, 202: removalPendingResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.userId as number;
      const result = await runAccountRemoval({
        targetId: userId,
        actorId: userId,
        source: "self_service",
        requestedAction: "delete",
        securityPin: req.body?.securityPin,
        reauthenticationPassword: req.body?.reauthenticationPassword,
        sessionToken: await sessionTokenFromRequest(req),
        preserveIdempotency: req.idempotency
          ? {
              key: req.idempotency.key,
              scope: req.idempotency.scope,
              completionScope: "DELETE /api/me removal-complete",
            }
          : undefined,
      });
      if (req.idempotency) req.idempotency.scope = "DELETE /api/me removal-complete";
      await invalidateCapabilities(userId);
      if (result.status !== "completed") {
        reply.code(202);
        return result;
      }
      if (!result.deleted) {
        throw new ConflictError(
          "This account must be anonymized because it has operational history.",
        );
      }
      return result;
    },
  );

  // Irreversible participant self-service anonymization (H54). The explicit
  // confirmation body keeps a replayed/malformed request from becoming a
  // destructive action, while the authenticated /me path prevents IDOR.
  api.post(
    "/api/me/anonymize",
    {
      preHandler: selfRemovalPreHandler("POST /api/me/anonymize removal-complete"),
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Anonymize my data and close my account",
        description:
          "H54 irreversible self-service anonymization. The request is accepted immediately; when the participant is inside, finalization waits for a valid exit. Unverified real accounts must re-enter their current password.",
        body: z
          .object({
            confirm: z.literal(true),
            securityPin: z
              .string()
              .regex(/^\d{6}$/)
              .optional(),
            reauthenticationPassword: z.string().min(1).max(128).optional(),
          })
          .strict(),
        response: { 200: removalCompletedResponseSchema, 202: removalPendingResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.userId as number;
      const result = await runAccountRemoval({
        targetId: userId,
        actorId: userId,
        source: "self_service",
        requestedAction: "anonymize",
        securityPin: req.body.securityPin,
        reauthenticationPassword: req.body.reauthenticationPassword,
        sessionToken: await sessionTokenFromRequest(req),
        preserveIdempotency: req.idempotency
          ? {
              key: req.idempotency.key,
              scope: req.idempotency.scope,
              completionScope: "POST /api/me/anonymize removal-complete",
            }
          : undefined,
      });
      if (req.idempotency) req.idempotency.scope = "POST /api/me/anonymize removal-complete";
      await invalidateCapabilities(userId);
      if (result.status !== "completed") {
        reply.code(202);
        return result;
      }
      if (!result.anonymized) {
        throw new ConflictError("This account has no operational history to anonymize.");
      }
      return result;
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
                role: badgeCategorySchema,
                language: z.string(),
                shirtSize: z.string().nullable(),
                applicationStatus: z.string().nullable(),
                confirmedSpot: z.boolean(),
                isTestAccount: z.boolean(),
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
      const where = filter
        ? `WHERE account_state = 'active' AND anonymized_at IS NULL
             AND is_test_account = false
             AND (name ILIKE $1 OR surname ILIKE $1 OR email ILIKE $1)`
        : `WHERE account_state = 'active' AND anonymized_at IS NULL
             AND is_test_account = false`;
      const args = filter ? [filter, limit, offset] : [limit, offset];
      const p = filter ? 2 : 1;
      // H8: role is resolved in this same query via a single join, rather than
      // one getBadgeCategory() call per row (was an N+1 capped at `limit`
      // rows) — same admin/judge/sponsor/staff-then-effective-role priority
      // as identity/role.ts's getBadgeCategory, via the same bulk-query views
      // logistics/stats.ts and scanner-sync.ts already use.
      const { rows } = await pool.query<UserRow & { role: BadgeCategory }>(
        `SELECT u.id, u.email, u.email_verified, u.name, u.surname, u.badge_id, u.language,
                u.shirt_size, u.is_test_account, u.created_at,
                CASE
                  WHEN EXISTS (
                    SELECT 1 FROM user_effective_capabilities uec
                     WHERE uec.user_id = u.id AND uec.capability = '*'
                  ) THEN 'admin'
                  WHEN EXISTS (SELECT 1 FROM enterprise_judges ej WHERE ej.user_id = u.id) THEN 'judge'
                  WHEN EXISTS (SELECT 1 FROM sponsors s WHERE s.user_id = u.id) THEN 'sponsor'
                  WHEN EXISTS (
                    SELECT 1 FROM user_effective_capabilities uec WHERE uec.user_id = u.id
                  ) THEN 'staff'
                  ELSE COALESCE(uebc.badge_category::text, 'unassigned')
                END AS role
           FROM users u
           LEFT JOIN user_effective_badge_category uebc ON uebc.user_id = u.id
           ${where}
           ORDER BY u.created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
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

      const users = rows.map((r) => ({
        id: r.id,
        email: r.email,
        emailVerified: r.email_verified,
        name: r.name,
        surname: r.surname,
        badgeId: r.badge_id,
        role: r.role,
        language: r.language,
        shirtSize: r.shirt_size,
        applicationStatus: statusByUser.get(r.id) ?? null,
        confirmedSpot: statusByUser.get(r.id) === "confirmed",
        isTestAccount: r.is_test_account,
        createdAt: r.created_at.toISOString(),
      }));

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
        description:
          "A staff member's view of another user's profile. `visibleRoleName` is the single " +
          "highest-visible role also shown elsewhere; `roles` is that user's complete " +
          "assigned-role set (H8) for a secondary role list — system:superadmin is stripped " +
          "out of it unless the viewer holds PERMISSIONS_MANAGE (irrelevant to an ordinary " +
          "USERS_READ viewer, and never advertised to them).",
        params: z.object({ id: z.coerce.number().int() }),
        response: {
          200: userResponseSchema.extend({
            role: badgeCategorySchema,
            visibleRoleName: z.string().nullable(),
            capabilities: z.array(z.string()),
            roles: z.array(assignedRoleSchema),
          }),
        },
      },
    },
    async (req) => {
      await assertProfileSubjectScope(req.userId as number, req.params.id);
      const row = await fetchUser(req.params.id);
      const [role, visibleRoleName, capabilities, allRoles, canSeeSuperadmin] = await Promise.all([
        getBadgeCategory(pool, req.params.id),
        getHighestVisibleRoleName(pool, req.params.id),
        getEffectiveCapabilities(req.params.id),
        getAssignedRoles(pool, req.params.id),
        userHasCapability(req.userId as number, CAPABILITIES.PERMISSIONS_MANAGE, req),
      ]);
      // H8: system:superadmin is CLI-only and never advertised to a staff
      // viewer browsing someone else's profile unless they themselves manage
      // permissions — it carries no operational meaning to an ordinary
      // USERS_READ viewer beyond "this account has every capability".
      const roles: AssignedRoleSummary[] = canSeeSuperadmin
        ? allRoles
        : allRoles.filter((r) => r.name !== SUPERADMIN_ROLE_NAME);
      return {
        ...serializeUser(row),
        role,
        visibleRoleName,
        capabilities: [...capabilities],
        roles,
      };
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
      await assertProfileSubjectScope(req.userId as number, req.params.id);
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
      await assertProfileSubjectScope(req.userId as number, req.params.id);
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
          "Classify an attendee as participant or mentor by granting the matching seeded Mentor/Participant role (H8) — an auditable, explicit staff action, distinct from a capability-bearing permission role (both seeded roles carry zero capabilities). The permanent ticket is issued in the same transaction. Re-classifying replaces whichever of the two roles this action previously granted.",
        response: {
          200: z.object({ role: z.enum(["participant", "mentor"]), ticketIssued: z.literal(true) }),
        },
      },
    },
    async (req) => {
      await assertProfileSubjectScope(req.userId as number, req.params.id);
      return withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT id FROM users
            WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
            FOR UPDATE`,
          [req.params.id],
        );
        if (!rows[0]) throw new NotFoundError("User not found", { userId: req.params.id });
        await assignAttendeeRole(client, req.params.id, req.body.role, req.userId as number);
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
      });
    },
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
      await assertProfileSubjectScope(req.userId as number, targetId);
      if (targetId === req.userId) {
        throw new BadRequestError("You can't remove your own account");
      }
      await fetchUser(targetId);
      return getAccountRemovalEligibility(pool, targetId);
    },
  );

  // Admin hard-delete (H54). The same locked server-side boundary is used as
  // for /api/me; this endpoint is only the staff form of the fresh-account
  // action and cannot be used to bypass anonymous retention.
  api.delete(
    "/api/users/:id",
    {
      preHandler: [requireCapability(CAPABILITIES.ADMIN_ALL), adminRemovalIdempotency],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: removalCompletedResponseSchema, 202: removalPendingResponseSchema },
      },
    },
    async (req, reply) => {
      const targetId = req.params.id;
      await assertProfileSubjectScope(req.userId as number, targetId);
      if (targetId === req.userId) {
        throw new BadRequestError("You can't delete your own account");
      }
      const result = await runAccountRemoval({
        targetId,
        actorId: req.userId as number,
        source: "admin",
        requestedAction: "delete",
      });
      await invalidateCapabilities(targetId);
      if (result.status !== "completed") {
        reply.code(202);
        return result;
      }
      if (!result.deleted) {
        throw new ConflictError("This account has operational history; anonymize it instead.");
      }
      return result;
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
      await assertProfileSubjectScope(req.userId as number, targetId);
      const email = req.body.email.trim().toLowerCase();
      const after = await withTransaction(async (client) => {
        const { rows: beforeRows } = await client.query(
          `SELECT * FROM users
            WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
            FOR UPDATE`,
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

  // Admin anonymization (H54). It uses the same transaction as self-service;
  // there is no in-place synthetic user row and no identity lookup table.
  api.post(
    "/api/users/:id/anonymize",
    {
      preHandler: [requireCapability(CAPABILITIES.ADMIN_ALL), adminRemovalIdempotency],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.ADMIN_ALL }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: removalCompletedResponseSchema, 202: removalPendingResponseSchema },
      },
    },
    async (req, reply) => {
      const targetId = req.params.id;
      await assertProfileSubjectScope(req.userId as number, targetId);
      if (targetId === req.userId) {
        throw new BadRequestError("Use the self-service account action for your own account");
      }
      const result = await runAccountRemoval({
        targetId,
        actorId: req.userId as number,
        source: "admin",
        requestedAction: "anonymize",
      });
      await invalidateCapabilities(targetId);
      if (result.status !== "completed") {
        reply.code(202);
        return result;
      }
      if (!result.anonymized) {
        throw new ConflictError("This account has no operational history to anonymize.");
      }
      return result;
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
                scannedAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const id = req.params.id;
      await assertProfileSubjectScope(req.userId as number, id);
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
            `SELECT id, kind, scanned_at
               FROM time_logs WHERE user_id = $1 ORDER BY scanned_at DESC LIMIT 200`,
            [id],
          )
          .then((r) =>
            r.rows.map((x: { id: number; kind: string; scanned_at: Date }) => ({
              id: x.id,
              kind: x.kind,
              scannedAt: x.scanned_at.toISOString(),
            })),
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
                applicationGrantedBadgeCategory: z.string().nullable(),
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
      await assertProfileSubjectScope(req.userId as number, userId);
      // Verify user exists
      await fetchUser(userId);

      const { rows: responseRows } = await pool.query(
        `SELECT r.*, a.name AS app_name,
                (SELECT ro.badge_category::text
                   FROM application_grants_roles agr
                   JOIN roles ro ON ro.id = agr.role_id AND ro.deleted_at IS NULL
                  WHERE agr.application_id = a.id
                  ORDER BY ro.position DESC
                  LIMIT 1) AS app_granted_badge_category
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
            applicationGrantedBadgeCategory:
              (row.app_granted_badge_category as string | null) ?? null,
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
