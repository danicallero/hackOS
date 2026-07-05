import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../../config.js";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireAuth, requireCapability } from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
import { enqueueAuthEmail } from "../outbox.js";

/**
 * Secondary email (H6): lets a participant register the address they used on
 * Devpost so the import (H16) can match their projects. Flow:
 *   POST /api/me/secondary-email          -> issues an email_verification_tokens
 *                                            row (type 'secondary_email') and
 *                                            queues the verification email
 *   POST /api/me/secondary-email/verify   -> consumes the token, stamps
 *                                            users.secondary_email_verified_at
 *
 * Admin route:
 *   POST /api/users/:userId/secondary-email -> admin sets secondary email for
 *                                              a user; triggers verification.
 *
 * Uniqueness rule (H6: "cada dirección identifica a una única cuenta"):
 * a secondary email may not equal ANY user's primary email, nor another
 * user's VERIFIED secondary email. Checked both at request time and again at
 * verification time (someone else may have claimed it in between) — explicit
 * 409s, never silent.
 */

const TOKEN_TTL_HOURS = 24;

export async function assertSecondaryEmailAvailable(
  email: string,
  ownUserId: number,
): Promise<void> {
  const { rows: primaryClash } = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
    email,
  ]);
  if (primaryClash.length > 0) {
    throw new ConflictError("This address is already someone's primary email", { email });
  }
  const { rows: secondaryClash } = await pool.query(
    `SELECT id FROM users
     WHERE secondary_email = $1 AND secondary_email_verified_at IS NOT NULL AND id <> $2
     LIMIT 1`,
    [email, ownUserId],
  );
  if (secondaryClash.length > 0) {
    throw new ConflictError("This address is already verified as another user's secondary email", {
      email,
    });
  }
}

export function registerSecondaryEmailRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/me/secondary-email",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({ email: z.string().email() }),
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const email = req.body.email.trim().toLowerCase();

      const { rows: selfRows } = await pool.query(
        `SELECT email, name, surname FROM users WHERE id = $1`,
        [userId],
      );
      if (!selfRows[0]) throw new NotFoundError("User not found");
      const self = selfRows[0] as { email: string; name: string | null; surname: string | null };
      if (self.email === email) {
        throw new BadRequestError("Secondary email cannot equal your own primary email");
      }
      await assertSecondaryEmailAvailable(email, userId);

      const token = randomBytes(32).toString("base64url");
      await withTransaction(async (client) => {
        // A new request supersedes any pending unverified token for this user.
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now()
           WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL`,
          [userId],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
           VALUES ($1, 'secondary_email', $2, $3, now() + make_interval(hours => $4))`,
          [token, email, userId, TOKEN_TTL_HOURS],
        );
        // Pending (not yet verified) address is stored so /me can show it.
        await client.query(
          `UPDATE users SET secondary_email = $2, secondary_email_verified_at = NULL WHERE id = $1`,
          [userId, email],
        );
        await enqueueAuthEmail(client, userId, "auth.verify", {
          recipient: email,
          name: self.name ?? "",
          verifyUrl: `${config.WEB_URL}/verify-secondary-email?token=${token}`,
        });
      });
      return { status: true as const };
    },
  );

  api.post(
    "/api/me/secondary-email/verify",
    {
      preHandler: requireAuth,
      schema: {
        body: z.object({ token: z.string().min(1) }),
        response: {
          200: z.object({ status: z.literal(true), alreadyVerified: z.boolean() }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { token } = req.body;

      return withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM email_verification_tokens
           WHERE token = $1 AND type = 'secondary_email' FOR UPDATE`,
          [token],
        );
        const row = rows[0] as
          | { id: number; email: string; user_id: number; expires_at: Date; used_at: Date | null }
          | undefined;
        if (!row || row.user_id !== userId) {
          throw new BadRequestError("Invalid verification token");
        }
        if (row.used_at !== null) {
          // Mirrors H2's UX contract: an already-used link answers "already
          // verified", not an error.
          const { rows: current } = await client.query(
            `SELECT secondary_email, secondary_email_verified_at FROM users WHERE id = $1`,
            [userId],
          );
          const user = current[0] as {
            secondary_email: string | null;
            secondary_email_verified_at: Date | null;
          };
          if (user.secondary_email === row.email && user.secondary_email_verified_at !== null) {
            return { status: true as const, alreadyVerified: true };
          }
          throw new BadRequestError("Verification token already used");
        }
        if (row.expires_at < new Date()) {
          throw new BadRequestError("Verification token expired — request a new one", {
            expired: true,
          });
        }

        // Re-check uniqueness at consumption time (H6): another account may
        // have registered/verified this address since the token was issued.
        await assertSecondaryEmailAvailable(row.email, userId);

        await client.query(`UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`, [
          row.id,
        ]);
        await client.query(
          `UPDATE users SET secondary_email = $2, secondary_email_verified_at = now() WHERE id = $1`,
          [userId, row.email],
        );
        await audit(client, {
          actorId: userId,
          entityType: "user",
          entityId: userId,
          action: "secondary_email_verified",
          source: "email",
          after: { secondary_email: row.email },
        });
        return { status: true as const, alreadyVerified: false };
      });
    },
  );

  // ── admin: set secondary email for a user (C) ───────────────────────────
  api.post(
    "/api/users/:userId/secondary-email",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_WRITE),
      schema: {
        params: z.object({ userId: z.coerce.number().int() }),
        body: z.object({ email: z.string().email() }),
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const targetId = req.params.userId;
      const email = req.body.email.trim().toLowerCase();

      const { rows: target } = await pool.query(
        `SELECT email, name, surname FROM users WHERE id = $1`,
        [targetId],
      );
      if (!target[0]) throw new NotFoundError("User not found", { userId: targetId });
      const tgt = target[0] as { email: string; name: string | null; surname: string | null };
      if (tgt.email === email) {
        throw new BadRequestError("Secondary email cannot equal the user's primary email");
      }
      await assertSecondaryEmailAvailable(email, targetId);

      const token = randomBytes(32).toString("base64url");
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now()
           WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL`,
          [targetId],
        );
        await client.query(
          `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
           VALUES ($1, 'secondary_email', $2, $3, now() + make_interval(hours => $4))`,
          [token, email, targetId, TOKEN_TTL_HOURS],
        );
        await client.query(
          `UPDATE users SET secondary_email = $2, secondary_email_verified_at = NULL WHERE id = $1`,
          [targetId, email],
        );
        await enqueueAuthEmail(client, targetId, "auth.verify", {
          recipient: email,
          name: tgt.name ?? "",
          verifyUrl: `${config.WEB_URL}/verify-secondary-email?token=${token}`,
        });
        await audit(client, {
          actorId: req.userId,
          entityType: "user",
          entityId: targetId,
          action: "secondary_email_admin_set",
          source: "admin",
          after: { secondary_email: email },
        });
      });
      return { status: true as const };
    },
  );
}
