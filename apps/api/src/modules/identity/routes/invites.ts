import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../../config.js";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
import { auth } from "../auth.js";

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
  created_at: Date;
}

function claimUrl(token: string): string {
  // Link to the WEB app's claim page (not the API host); it looks up the
  // invite and lets the person create their account.
  return `${config.WEB_URL}/claim-account?token=${token}`;
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
        vars: { claimUrl: claimUrl(token) },
      }),
    ],
  );
}

export function registerInviteRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INVITES_MANAGE);

  // ── create (H10; H9/H43 use kind=sponsor + enterpriseId) ─────────────────

  api.post(
    "/api/invites",
    {
      preHandler: manage,
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
        const { rows } = await client.query(
          `INSERT INTO email_verification_tokens (token, type, email, enterprise_id, kind, group_ids, expires_at)
           VALUES ($1, $2::token_type, $3, $4, $5, $6, now() + make_interval(hours => $7))
           RETURNING *`,
          [token, type, email, enterpriseId ?? null, kind, groupIds, INVITE_TTL_HOURS],
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
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 201: inviteResponse },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE id = $1 AND type IN ('sponsor_invite', 'account_claim') FOR UPDATE`,
          [id],
        );
        const old = rows[0] as TokenRow | undefined;
        if (!old) throw new NotFoundError("Invite not found", { id });
        if (old.used_at !== null && old.user_id !== null) {
          // user_id gets stamped on acceptance; used_at alone can also mean
          // "superseded by an earlier regeneration"
          throw new ConflictError("Invite already accepted — nothing to regenerate", { id });
        }

        // Old token stops working immediately (H9: "si el enlace caducó, la
        // organización puede generar otro" — one live link at a time).
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
          [id],
        );

        const token = randomBytes(32).toString("base64url");
        const { rows: newRows } = await client.query(
          `INSERT INTO email_verification_tokens (token, type, email, enterprise_id, kind, group_ids, expires_at)
           VALUES ($1, $2::token_type, $3, $4, $5, $6, now() + make_interval(hours => $7))
           RETURNING *`,
          [
            token,
            old.type,
            old.email,
            old.enterprise_id,
            old.kind,
            old.group_ids,
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
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ success: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE id = $1 AND type IN ('sponsor_invite', 'account_claim') FOR UPDATE`,
          [id],
        );
        const invite = rows[0] as TokenRow | undefined;
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
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ expiresAt: z.string() }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE id = $1 AND type IN ('sponsor_invite', 'account_claim') FOR UPDATE`,
          [id],
        );
        const invite = rows[0] as TokenRow | undefined;
        if (!invite) throw new NotFoundError("Invite not found", { id });
        if (invite.used_at !== null) {
          throw new ConflictError("Invite already used — cannot renew", { id });
        }
        if (invite.user_id !== null) {
          throw new ConflictError("Invite already accepted — cannot renew", { id });
        }
        const { rows: updated } = await client.query(
          `UPDATE email_verification_tokens
           SET expires_at = now() + make_interval(hours => $2)
           WHERE id = $1
           RETURNING expires_at`,
          [id, INVITE_TTL_HOURS],
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
      schema: {
        params: z.object({ id: z.coerce.number().int() }),
        response: { 200: z.object({ success: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE id = $1 AND type IN ('sponsor_invite', 'account_claim') FOR UPDATE`,
          [id],
        );
        const invite = rows[0] as TokenRow | undefined;
        if (!invite) throw new NotFoundError("Invite not found", { id });
        if (invite.used_at !== null) {
          throw new ConflictError("Invite already used — cannot resend", { id });
        }
        if (invite.user_id !== null) {
          throw new ConflictError("Invite already accepted — cannot resend", { id });
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
      schema: {
        querystring: z.object({ token: z.string().min(1) }),
        response: {
          200: z.object({
            email: z.string(),
            kind: inviteKind,
            expired: z.boolean(),
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
      if (!row || row.used_at !== null) throw new NotFoundError("Invite not found or already used");
      return {
        email: row.email,
        kind: (row.kind ?? "staff") as z.infer<typeof inviteKind>,
        expired: row.expires_at < new Date(),
      };
    },
  );

  // ── public: accept (H9/H10 — the invitee fills their own data) ───────────

  api.post(
    "/api/invites/accept",
    {
      schema: {
        body: z.object({
          token: z.string().min(1),
          name: z.string().min(1).max(200),
          surname: z.string().min(1).max(200),
          password: z.string().min(8).max(128),
          phone: z.string().max(50).optional(),
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
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE token = $1 AND type IN ('sponsor_invite', 'account_claim')
           FOR UPDATE`,
          [token],
        );
        const invite = rows[0] as TokenRow | undefined;
        if (!invite) throw new NotFoundError("Invite not found");
        if (invite.used_at !== null) {
          throw new ConflictError("Invite already used", { inviteId: invite.id });
        }
        if (invite.expires_at < new Date()) {
          throw new ConflictError("Invite expired — ask the organization to send a new one", {
            expired: true,
          });
        }
        const kind = (invite.kind ?? (invite.type === "sponsor_invite" ? "sponsor" : "staff")) as
          | "staff"
          | "sponsor"
          | "participant";

        // Only participants must provide a shirt size (catering/logistics for
        // attendees). Staff and sponsors don't need one. Dietary restrictions
        // are NEVER required — an invitee may simply have none.
        if (kind === "participant" && !req.body.shirtSize) {
          throw new BadRequestError("Shirt size is required", { field: "shirtSize" });
        }

        const { rows: clash } = await client.query(`SELECT id FROM users WHERE email = $1`, [
          invite.email,
        ]);
        if (clash.length > 0) {
          throw new ConflictError("An account with this email already exists", {
            email: invite.email,
          });
        }

        // Account creation goes through Better Auth so the password hash /
        // credential account land exactly where sign-in expects them (H1, H10).
        const signup = await auth.api.signUpEmail({
          body: { email: invite.email, password, name, surname },
        });
        const userId = Number(signup.user.id);

        // Following the emailed invite link proves mailbox ownership: mark
        // verified and drop the redundant "verify your email" the sign-up
        // hook just queued.
        await client.query(
          `UPDATE users
           SET email_verified = true,
               phone = COALESCE($2, phone),
               language = COALESCE($3, language),
               food_intolerances = COALESCE($4, food_intolerances),
               food_intolerance_notes = COALESCE($5, food_intolerance_notes),
               shirt_size = COALESCE($6, shirt_size)
           WHERE id = $1`,
          [
            userId,
            req.body.phone ?? null,
            req.body.language ?? null,
            req.body.foodIntolerances ?? null,
            req.body.foodIntoleranceNotes ?? null,
            req.body.shirtSize ?? null,
          ],
        );
        await client.query(
          `DELETE FROM notification_outbox
           WHERE user_id = $1 AND status = 'queued' AND payload->>'template' = 'auth.verify'`,
          [userId],
        );

        await client.query(
          `UPDATE email_verification_tokens SET used_at = now(), user_id = $2 WHERE id = $1`,
          [invite.id, userId],
        );

        if (kind === "sponsor" && invite.enterprise_id !== null) {
          // H9/H43: link to the enterprise automatically.
          await client.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
            invite.enterprise_id,
            userId,
          ]);
        }

        // H8/H10: pre-assigned capability groups. Skip ids for groups deleted
        // since the invite was issued (WHERE EXISTS avoids an FK violation).
        for (const groupId of invite.group_ids ?? []) {
          await client.query(
            `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
             SELECT $1, $2, NULL
             WHERE EXISTS (SELECT 1 FROM permission_groups WHERE id = $2)
             ON CONFLICT DO NOTHING`,
            [userId, groupId],
          );
        }

        await audit(client, {
          actorId: userId,
          entityType: "invite",
          entityId: invite.id,
          action: "accept",
          source: "email",
          after: { userId, kind, enterpriseId: invite.enterprise_id, groupIds: invite.group_ids },
        });

        return { userId, email: invite.email, kind };
      });

      return reply.code(201).send(result);
    },
  );
}
