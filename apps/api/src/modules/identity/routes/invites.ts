import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../../lib/errors.js";
import { keyByIp, rateLimitGuard } from "../../../lib/rate-limit.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { issueTicket } from "../../logistics/tickets.js";
import { auth } from "../auth.js";
import {
  groupContainsWildcard,
  lockPermissionGraph,
  requireWildcardGraphAuthority,
  userHasAnyCapability,
} from "../permission-graph.js";
import {
  enterpriseInviteClaimUrl,
  enterpriseInviteLinkIsExpired,
  findEnterpriseInviteLink,
  registerEnterpriseInviteLinkRoutes,
} from "./enterprise-invite-links.js";

/**
 * Whether an invited sponsor/staff account is asked for a shirt size and/or
 * dietary restrictions before claiming — event-configurable per kind, since
 * not every event caters on-site sponsors/staff (H10). `requireShirtSize`
 * blocks the claim when missing; `requireDietary` only controls whether the
 * claim form shows the dietary fields for this kind — like everywhere else
 * in the app (H12), dietary answers are never a hard block, since an
 * invitee may simply have none. Participants are unaffected: their shirt
 * size is always required, their dietary fields always shown.
 */
async function inviteRequirements(
  kind: "staff" | "sponsor" | "participant",
): Promise<{ requireShirtSize: boolean; requireDietary: boolean }> {
  if (kind === "participant") return { requireShirtSize: true, requireDietary: true };
  const { rows } = await pool.query(
    `SELECT require_sponsor_shirt_size, require_sponsor_dietary,
            require_staff_shirt_size, require_staff_dietary
       FROM event_config WHERE id = 1`,
  );
  const row = rows[0] ?? {
    require_sponsor_shirt_size: false,
    require_sponsor_dietary: false,
    require_staff_shirt_size: false,
    require_staff_dietary: false,
  };
  return kind === "sponsor"
    ? {
        requireShirtSize: row.require_sponsor_shirt_size,
        requireDietary: row.require_sponsor_dietary,
      }
    : { requireShirtSize: row.require_staff_shirt_size, requireDietary: row.require_staff_dietary };
}

/**
 * Invitations (H9, H10): admin creates an invite by email + kind
 * (staff | sponsor | participant); the invited person follows the link and
 * creates their OWN account (name, surname, password, food intolerances,
 * shirt size where applicable) — the admin never fills anyone's data in.
 *
 * Token storage: email_verification_tokens with type 'sponsor_invite'
 * (kind=sponsor, carries enterprise_id) or 'account_claim' (staff /
 * participant). The `kind` column (migration 0101) tells acceptance which
 * profile fields to demand. Expired invite -> the org regenerates
 * (POST /:id/regenerate): new token row, old one stamped used (H9).
 *
 * The invite email is queued through notification_outbox like every other
 * auth email. The invitee has no user row yet, and outbox.user_id is NOT
 * NULL -> the row is attached to the INVITING admin with the real recipient
 * in payload.recipient (see brief: payload carries template, recipient,
 * language, url; the notifications workstream owns delivery and must honor
 * payload.recipient over the user's own address for category 'auth' invites).
 */

const INVITE_TTL_HOURS = 24 * 7;

const inviteKind = z.enum(["staff", "sponsor", "participant"]);

const inviteResponse = z.object({
  id: z.number(),
  email: z.string(),
  kind: inviteKind,
  enterpriseId: z.number().nullable(),
  // Capability groups the invitee is added to on acceptance (H8/H10).
  groupIds: z.array(z.number()),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  // token returned to the admin so the link can also be handed over manually
  token: z.string().nullable(),
});

interface TokenRow {
  id: number;
  token: string;
  type: string;
  email: string;
  user_id: number | null;
  enterprise_id: number | null;
  expires_at: Date;
  used_at: Date | null;
  kind: string | null;
  group_ids: number[];
  wildcard_authorized: boolean;
  created_at: Date;
}

/**
 * Deferred group grants need a fresh closure check at every privileged token
 * operation. Missing groups intentionally mean a deleted assignment (and no
 * grant); initial creation is the one operation that rejects an unknown id.
 */
async function inviteContainsWildcardGroup(
  client: Parameters<typeof groupContainsWildcard>[0],
  groupIds: readonly number[],
  { requireExisting = false }: { requireExisting?: boolean } = {},
): Promise<boolean> {
  let containsWildcard = false;
  for (const groupId of groupIds) {
    const { rows } = await client.query(`SELECT id FROM permission_groups WHERE id = $1`, [
      groupId,
    ]);
    if (!rows[0]) {
      if (requireExisting) throw new NotFoundError("Permission group not found", { groupId });
      continue;
    }
    if (await groupContainsWildcard(client, groupId)) containsWildcard = true;
  }
  return containsWildcard;
}

async function requireWildcardInviteAuthority(
  client: Parameters<typeof groupContainsWildcard>[0],
  actorId: number,
  groupIds: readonly number[],
  options?: { requireExisting?: boolean },
): Promise<boolean> {
  const containsWildcard = await inviteContainsWildcardGroup(client, groupIds, options);
  if (containsWildcard) await requireWildcardGraphAuthority(client, actorId);
  return containsWildcard;
}

async function loadInviteForUpdate(
  client: Parameters<typeof groupContainsWildcard>[0],
  id: number,
): Promise<TokenRow | undefined> {
  const { rows } = await client.query(
    `SELECT * FROM email_verification_tokens
     WHERE id = $1 AND type IN ('sponsor_invite', 'account_claim') FOR UPDATE`,
    [id],
  );
  return rows[0] as TokenRow | undefined;
}

async function enqueueInviteEmail(
  db: Parameters<typeof audit>[0],
  actorId: number,
  recipient: string,
  language: string,
  token: string,
): Promise<void> {
  await db.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, 'auth', 'email', $2::jsonb)`,
    [
      actorId,
      JSON.stringify({
        template: "auth.invite",
        recipient,
        language,
        vars: { claimUrl: enterpriseInviteClaimUrl(token) },
      }),
    ],
  );
}

export function registerInviteRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INVITES_MANAGE);

  registerEnterpriseInviteLinkRoutes(app);

  // ── create (H10; H9/H43 use kind=sponsor + enterpriseId) ─────────────────

  api.post(
    "/api/invites",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        body: z.object({
          email: z.string().email(),
          kind: inviteKind,
          enterpriseId: z.number().int().optional(),
          // Capability groups pre-assigned on acceptance (H8/H10).
          groupIds: z.array(z.number().int()).default([]),
        }),
        response: { 201: inviteResponse },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      const { kind, enterpriseId, groupIds } = req.body;

      if (kind === "sponsor" && enterpriseId === undefined) {
        throw new BadRequestError("Sponsor invites require enterpriseId");
      }
      if (kind !== "sponsor" && enterpriseId !== undefined) {
        throw new BadRequestError("enterpriseId is only valid for sponsor invites");
      }

      const { rows: existingUser } = await pool.query(`SELECT id FROM users WHERE email = $1`, [
        email,
      ]);
      if (existingUser.length > 0) {
        // Admin-facing endpoint — enumeration safety doesn't apply here (H10
        // admins hold INVITES_MANAGE); an explicit conflict beats a dead invite.
        throw new ConflictError("A user with this email already exists", { email });
      }
      if (enterpriseId !== undefined) {
        const { rows } = await pool.query(`SELECT id FROM enterprises WHERE id = $1`, [
          enterpriseId,
        ]);
        if (rows.length === 0) throw new NotFoundError("Enterprise not found", { enterpriseId });
      }

      const token = randomBytes(32).toString("base64url");
      const type = kind === "sponsor" ? "sponsor_invite" : "account_claim";

      const row = await withTransaction(async (client) => {
        // An invitation is a deferred membership assignment. Validate its
        // targets while the graph is locked, so a permissions manager cannot
        // smuggle wildcard access through account creation (H8/H10, H53).
        await lockPermissionGraph(client);
        const wildcardAuthorized = await requireWildcardInviteAuthority(
          client,
          req.userId as number,
          groupIds,
          { requireExisting: true },
        );
        const { rows } = await client.query(
          `INSERT INTO email_verification_tokens
             (token, type, email, enterprise_id, kind, group_ids, wildcard_authorized, expires_at)
           VALUES ($1, $2::token_type, $3, $4, $5, $6, $7, now() + make_interval(hours => $8))
           RETURNING *`,
          [
            token,
            type,
            email,
            enterpriseId ?? null,
            kind,
            groupIds,
            wildcardAuthorized,
            INVITE_TTL_HOURS,
          ],
        );
        const created = rows[0] as TokenRow;
        await enqueueInviteEmail(client, req.userId as number, email, "en", token);
        await audit(client, {
          actorId: req.userId,
          entityType: "invite",
          entityId: created.id,
          action: "create",
          source: "admin",
          after: { email, kind, enterpriseId: enterpriseId ?? null, groupIds },
        });
        return created;
      });

      return reply.code(201).send({
        id: row.id,
        email: row.email,
        kind,
        enterpriseId: row.enterprise_id,
        groupIds: row.group_ids,
        expiresAt: row.expires_at.toISOString(),
        usedAt: null,
        token,
      });
    },
  );

  // ── list active invites (H9/H10 — admin overview) ────────────────────────

  api.get(
    "/api/invites",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        response: {
          200: z.array(
            z.object({
              id: z.number(),
              email: z.string(),
              kind: inviteKind,
              enterpriseId: z.number().nullable(),
              groupIds: z.array(z.number()),
              expiresAt: z.string(),
              createdAt: z.string(),
            }),
          ),
        },
      },
    },
    async () => {
      const { rows } = await pool.query(
        `SELECT * FROM email_verification_tokens
         WHERE type IN ('sponsor_invite', 'account_claim')
           AND used_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC`,
      );
      return rows.map((row: TokenRow) => ({
        id: row.id,
        email: row.email,
        kind: (row.kind ?? "staff") as z.infer<typeof inviteKind>,
        enterpriseId: row.enterprise_id,
        groupIds: row.group_ids,
        expiresAt: row.expires_at.toISOString(),
        createdAt: row.created_at.toISOString(),
      }));
    },
  );

  // ── regenerate an expired/lost invite (H9) ───────────────────────────────

  api.post(
    "/api/invites/:id/regenerate",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 201: inviteResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const result = await withTransaction(async (client) => {
        await lockPermissionGraph(client);
        const old = await loadInviteForUpdate(client, id);
        if (!old) throw new NotFoundError("Invite not found", { id });
        if (old.used_at !== null && old.user_id !== null) {
          // user_id gets stamped on acceptance; used_at alone can also mean
          // "superseded by an earlier regeneration"
          throw new ConflictError("Invite already accepted — nothing to regenerate", { id });
        }
        const currentWildcard = await requireWildcardInviteAuthority(
          client,
          req.userId as number,
          old.group_ids,
        );
        const wildcardAuthorized = old.wildcard_authorized || currentWildcard;

        // Old token stops working immediately (H9: "si el enlace caducó, la
        // organización puede generar otro" — one live link at a time).
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
          [id],
        );

        const token = randomBytes(32).toString("base64url");
        const { rows: newRows } = await client.query(
          `INSERT INTO email_verification_tokens
             (token, type, email, enterprise_id, kind, group_ids, wildcard_authorized, expires_at)
           VALUES ($1, $2::token_type, $3, $4, $5, $6, $7, now() + make_interval(hours => $8))
           RETURNING *`,
          [
            token,
            old.type,
            old.email,
            old.enterprise_id,
            old.kind,
            old.group_ids,
            wildcardAuthorized,
            INVITE_TTL_HOURS,
          ],
        );
        const created = newRows[0] as TokenRow;
        await enqueueInviteEmail(client, req.userId as number, old.email, "en", token);
        await audit(client, {
          actorId: req.userId,
          entityType: "invite",
          entityId: created.id,
          action: "regenerate",
          source: "admin",
          before: { previousTokenId: id },
          after: { email: old.email, kind: old.kind },
        });
        return { created, token };
      });

      return reply.code(201).send({
        id: result.created.id,
        email: result.created.email,
        kind: (result.created.kind ?? "staff") as z.infer<typeof inviteKind>,
        enterpriseId: result.created.enterprise_id,
        groupIds: result.created.group_ids,
        expiresAt: result.created.expires_at.toISOString(),
        usedAt: null,
        token: result.token,
      });
    },
  );

  // ── expire — immediately invalidate an invite ─────────────────────────

  api.post(
    "/api/invites/:id/expire",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ success: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      await withTransaction(async (client) => {
        const invite = await loadInviteForUpdate(client, id);
        if (!invite) throw new NotFoundError("Invite not found", { id });
        if (invite.user_id !== null) {
          throw new ConflictError("Invite already accepted — cannot expire", { id });
        }
        await client.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [
          id,
        ]);
        await audit(client, {
          actorId: req.userId,
          entityType: "invite",
          entityId: id,
          action: "expire",
          source: "admin",
          before: { email: invite.email, kind: invite.kind },
        });
      });
      return reply.code(200).send({ success: true });
    },
  );

  // ── renew — extend the existing token's window ────────────────────────

  api.post(
    "/api/invites/:id/renew",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ expiresAt: z.string() }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const result = await withTransaction(async (client) => {
        await lockPermissionGraph(client);
        const invite = await loadInviteForUpdate(client, id);
        if (!invite) throw new NotFoundError("Invite not found", { id });
        if (invite.used_at !== null) {
          throw new ConflictError("Invite already used — cannot renew", { id });
        }
        if (invite.user_id !== null) {
          throw new ConflictError("Invite already accepted — cannot renew", { id });
        }
        const containsWildcard = await requireWildcardInviteAuthority(
          client,
          req.userId as number,
          invite.group_ids,
        );
        const { rows: updated } = await client.query(
          `UPDATE email_verification_tokens
           SET expires_at = now() + make_interval(hours => $2),
               wildcard_authorized = wildcard_authorized OR $3
           WHERE id = $1
           RETURNING expires_at`,
          [id, INVITE_TTL_HOURS, containsWildcard],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "invite",
          entityId: id,
          action: "renew",
          source: "admin",
          before: { email: invite.email, expiresAt: invite.expires_at.toISOString() },
          after: { expiresAt: (updated[0] as { expires_at: Date }).expires_at.toISOString() },
        });
        return (updated[0] as { expires_at: Date }).expires_at;
      });
      return reply.code(200).send({ expiresAt: result.toISOString() });
    },
  );

  // ── resend — re-queue the invite email with the same token ───────────

  api.post(
    "/api/invites/:id/resend",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ success: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      await withTransaction(async (client) => {
        await lockPermissionGraph(client);
        const invite = await loadInviteForUpdate(client, id);
        if (!invite) throw new NotFoundError("Invite not found", { id });
        if (invite.used_at !== null) {
          throw new ConflictError("Invite already used — cannot resend", { id });
        }
        if (invite.user_id !== null) {
          throw new ConflictError("Invite already accepted — cannot resend", { id });
        }
        const containsWildcard = await requireWildcardInviteAuthority(
          client,
          req.userId as number,
          invite.group_ids,
        );
        if (containsWildcard) {
          await client.query(
            `UPDATE email_verification_tokens SET wildcard_authorized = true WHERE id = $1`,
            [id],
          );
        }
        await enqueueInviteEmail(client, req.userId as number, invite.email, "en", invite.token);
        await audit(client, {
          actorId: req.userId,
          entityType: "invite",
          entityId: id,
          action: "resend",
          source: "admin",
          before: { email: invite.email },
        });
      });
      return reply.code(200).send({ success: true });
    },
  );

  // ── public: inspect an invite before accepting ───────────────────────────

  api.get(
    "/api/invites/lookup",
    {
      config: routeAccess({ kind: "token", policy: "invite-lookup" }),
      // #538: unauthenticated, token-guarded — rate limited per IP against
      // token-enumeration scanning.
      preHandler: rateLimitGuard("invite-lookup", { windowSeconds: 60, max: 30 }, keyByIp),
      schema: {
        description:
          "Inspect an invite token before accepting it (H9/H10) — resolves an email-verification-token invite or an enterprise invite link. Public, unauthenticated; rate limited to 30/min per IP (#538).",
        querystring: z.object({ token: z.string().min(1) }),
        response: {
          200: z.object({
            email: z.string().nullable(),
            kind: inviteKind,
            enterpriseName: z.string().nullable(),
            reusable: z.boolean(),
            maxRedeems: z.number().nullable(),
            redeemedCount: z.number(),
            remainingRedeems: z.number().nullable(),
            expired: z.boolean(),
            requireShirtSize: z.boolean(),
            requireDietary: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT * FROM email_verification_tokens
         WHERE token = $1 AND type IN ('sponsor_invite', 'account_claim')`,
        [req.query.token],
      );
      const row = rows[0] as TokenRow | undefined;
      if (row && row.used_at === null) {
        let enterpriseName: string | null = null;
        if (row.enterprise_id !== null) {
          const { rows: enterprises } = await pool.query(
            `SELECT name FROM enterprises WHERE id = $1`,
            [row.enterprise_id],
          );
          enterpriseName = (enterprises[0] as { name?: string } | undefined)?.name ?? null;
        }
        const kind = (row.kind ?? "staff") as z.infer<typeof inviteKind>;
        return {
          email: row.email,
          kind,
          enterpriseName,
          reusable: false,
          maxRedeems: null,
          redeemedCount: 0,
          remainingRedeems: null,
          expired: row.expires_at < new Date(),
          ...(await inviteRequirements(kind)),
        };
      }

      const link = await findEnterpriseInviteLink(pool, req.query.token);
      if (!link) throw new NotFoundError("Invite not found or already used");
      const { rows: enterprises } = await pool.query(`SELECT name FROM enterprises WHERE id = $1`, [
        link.enterprise_id,
      ]);
      return {
        email: null,
        kind: "sponsor" as const,
        enterpriseName: (enterprises[0] as { name?: string } | undefined)?.name ?? null,
        reusable: true,
        maxRedeems: link.max_redeems,
        redeemedCount: link.redeemed_count,
        remainingRedeems:
          link.max_redeems === null ? null : Math.max(0, link.max_redeems - link.redeemed_count),
        expired: enterpriseInviteLinkIsExpired(link),
        ...(await inviteRequirements("sponsor")),
      };
    },
  );

  // ── public: accept (H9/H10 — the invitee fills their own data) ───────────

  api.post(
    "/api/invites/accept",
    {
      config: routeAccess({ kind: "token", policy: "invite-accept" }),
      // #538: unauthenticated, token-guarded account creation — rate limited
      // per IP against token brute-forcing.
      preHandler: rateLimitGuard("invite-accept", { windowSeconds: 3600, max: 20 }, keyByIp),
      schema: {
        description:
          "Redeem an invite token and create the invitee's account (H9/H10). Public, unauthenticated; rate limited to 20/hour per IP (#538).",
        body: z.object({
          token: z.string().min(1),
          email: z.string().email().optional(),
          name: z.string().min(1).max(200),
          surname: z.string().min(1).max(200),
          password: z.string().min(8).max(128),
          language: z.enum(["en", "es", "gl"]).optional(),
          foodIntolerances: z.array(z.number().int()).default([]),
          foodIntoleranceNotes: z.string().max(2000).nullable().optional(),
          // Optional: only participants must supply a shirt size (enforced in the
          // handler once we know the invite kind). Staff/sponsors can skip it.
          shirtSize: z.string().min(1).max(10).nullish(),
        }),
        response: {
          201: z.object({
            userId: z.number(),
            email: z.string(),
            kind: inviteKind,
          }),
        },
      },
    },
    async (req, reply) => {
      const { token, name, surname, password } = req.body;

      // The whole acceptance runs in ONE transaction holding a FOR UPDATE
      // lock on the token row, so concurrent double-submits of the same
      // invite serialize: exactly one winner consumes the token, the loser
      // re-reads used_at != null and gets a 409 (plan/07 §2: one winner per
      // transition). Better Auth's own user/account writes commit on its own
      // connections, so a rollback here after signUpEmail can leave the
      // account created with the token unconsumed — a retry then 409s on
      // "email already exists" and staff resolves it; the audit trail stays
      // consistent either way.
      const result = await withTransaction(async (client) => {
        await lockPermissionGraph(client);
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE token = $1 AND type IN ('sponsor_invite', 'account_claim')
           FOR UPDATE`,
          [token],
        );
        const invite = rows[0] as TokenRow | undefined;
        const link = invite ? undefined : await findEnterpriseInviteLink(client, token, true);
        if (!invite && !link) throw new NotFoundError("Invite not found");
        if (invite && invite.used_at !== null) {
          throw new ConflictError("Invite already used", { inviteId: invite.id });
        }
        if (invite && invite.expires_at < new Date()) {
          throw new ConflictError("Invite expired — ask the organization to send a new one", {
            expired: true,
          });
        }
        if (link && enterpriseInviteLinkIsExpired(link)) {
          throw new ConflictError("Invite expired — ask the organization to send a new one", {
            expired: true,
          });
        }
        if (
          invite &&
          (await inviteContainsWildcardGroup(client, invite.group_ids)) &&
          !invite.wildcard_authorized
        ) {
          throw new ForbiddenError(
            "This invitation was not authorized to grant the wildcard capability",
          );
        }
        const kind = invite
          ? ((invite.kind ?? (invite.type === "sponsor_invite" ? "sponsor" : "staff")) as
              | "staff"
              | "sponsor"
              | "participant")
          : "sponsor";
        const email = invite ? invite.email : req.body.email?.trim().toLowerCase();
        if (!email) {
          throw new BadRequestError("Email is required for an enterprise invite link", {
            field: "email",
          });
        }

        // Participants always require a shirt size (logistics — H12). Whether
        // an invited sponsor/staff account must supply one too is
        // event-configurable (H10). Dietary restrictions are collected
        // whenever the event asks for them but — like everywhere else in the
        // app (H12) — are never a hard block: an invitee may simply have none.
        const { requireShirtSize } = await inviteRequirements(kind);
        if (requireShirtSize && !req.body.shirtSize) {
          throw new BadRequestError("Shirt size is required", { field: "shirtSize" });
        }

        const { rows: clash } = await client.query(`SELECT id FROM users WHERE email = $1`, [
          email,
        ]);
        if (clash.length > 0) {
          throw new ConflictError("An account with this email already exists", { email });
        }

        // Account creation goes through Better Auth so the password hash /
        // credential account land exactly where sign-in expects them (H1, H10).
        const signup = await auth.api.signUpEmail({
          body: { email, password, name, surname },
        });
        const userId = Number(signup.user.id);

        // The email-bound link proves mailbox ownership. A reusable enterprise
        // link does not, so it keeps the verification email Better Auth queued.
        await client.query(
          `UPDATE users
           SET email_verified = CASE WHEN $6 THEN true ELSE email_verified END,
               language = COALESCE($2, language),
               food_intolerances = COALESCE($3, food_intolerances),
               food_intolerance_notes = COALESCE($4, food_intolerance_notes),
               dietary_data_state = CASE
                 WHEN cardinality(COALESCE($3, food_intolerances)) > 0
                   OR NULLIF(BTRIM(COALESCE($4, food_intolerance_notes)), '') IS NOT NULL
                 THEN 'present'
                 ELSE 'not_provided'
               END,
               shirt_size = COALESCE($5, shirt_size)
           WHERE id = $1`,
          [
            userId,
            req.body.language ?? null,
            req.body.foodIntolerances ?? null,
            req.body.foodIntoleranceNotes ?? null,
            req.body.shirtSize ?? null,
            Boolean(invite),
          ],
        );
        if (invite) {
          await client.query(
            `DELETE FROM notification_outbox
             WHERE user_id = $1 AND status = 'queued' AND payload->>'template' = 'auth.verify'`,
            [userId],
          );
          await client.query(
            `UPDATE email_verification_tokens SET used_at = now(), user_id = $2 WHERE id = $1`,
            [invite.id, userId],
          );
        }

        const enterpriseId = invite?.enterprise_id ?? link?.enterprise_id ?? null;
        if (kind === "sponsor" && enterpriseId !== null) {
          // H9/H43: link to the enterprise automatically.
          await client.query(
            `INSERT INTO sponsors (enterprise_id, user_id)
             SELECT $1, $2
             WHERE NOT EXISTS (
               SELECT 1 FROM sponsors WHERE enterprise_id = $1 AND user_id = $2
             )`,
            [enterpriseId, userId],
          );
          await issueTicket(client, userId);
        }

        if (link) {
          await client.query(
            `INSERT INTO enterprise_invite_link_redemptions (link_id, user_id, email, name)
             VALUES ($1, $2, $3, $4)`,
            [link.id, userId, email, [name, surname].filter(Boolean).join(" ")],
          );
          await client.query(
            `UPDATE enterprise_invite_links
                SET redeemed_count = redeemed_count + 1
              WHERE id = $1`,
            [link.id],
          );
        }

        // H8/H10: pre-assigned capability groups. The invitation creator
        // validated every assignment under the same graph lock. A deleted
        // group is intentionally skipped: deletion revokes deferred grants.
        for (const groupId of invite?.group_ids ?? []) {
          await client.query(
            `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
             SELECT $1, $2, NULL
             WHERE EXISTS (SELECT 1 FROM permission_groups WHERE id = $2)
             ON CONFLICT DO NOTHING`,
            [userId, groupId],
          );
        }

        // Staff status starts only once an effective capability is assigned.
        // Sponsors are already ticketed above regardless of capability grants.
        if (kind === "staff") {
          if (await userHasAnyCapability(client, userId)) await issueTicket(client, userId);
        }

        await audit(client, {
          actorId: userId,
          entityType: link ? "enterprise_invite_link" : "invite",
          entityId: invite?.id ?? link?.id ?? 0,
          action: "accept",
          source: link ? "link" : "email",
          after: {
            userId,
            kind,
            enterpriseId,
            groupIds: invite?.group_ids ?? [],
            reusable: Boolean(link),
          },
        });

        return { userId, email, kind };
      });

      return reply.code(201).send(result);
    },
  );
}
