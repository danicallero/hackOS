import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";
import { assertFixtureSubjectScope } from "./review-fixture-scope.js";
import { PASS_TYPE_IDENTIFIER } from "./wallet.js";

/**
 * Creates the permanent entrance credential for any attendee category. The
 * unique user key makes repeated role transitions safe (plan/07 invariant 10).
 */
export async function issueTicket(client: pg.PoolClient, userId: number): Promise<string> {
  // H54: ticket issuance is an identity-bearing credential mutation. The
  // caller may have resolved eligibility earlier, so re-check while sharing
  // the user row lock with account removal immediately before minting.
  const active = await client.query(
    `SELECT 1 FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [userId],
  );
  if (!active.rows[0]) throw new NotFoundError("User not found");
  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query(
    `INSERT INTO tickets (user_id, token) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING token`,
    [userId, token],
  );
  if (rows[0]) return rows[0].token as string;
  const existing = await client.query(`SELECT token FROM tickets WHERE user_id = $1`, [userId]);
  return existing.rows[0].token as string;
}

export async function ticketQrPayload(userId: number, actorId?: number) {
  if (actorId != null) await assertFixtureSubjectScope(pool, actorId, userId);
  const [{ rows }, { rows: acceptedRows }, { rows: applePassRows }, eventAccess] =
    await Promise.all([
      pool.query(
        `SELECT u.id, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
        [userId],
      ),
      pool.query(
        `SELECT r.id AS response_id, a.name AS application_name, a.type AS application_type,
              evt.expires_at
         FROM application_responses r
         JOIN applications a ON a.id = r.application_id
         LEFT JOIN email_verification_tokens evt ON evt.id = r.confirmation_token_id
        WHERE r.user_id = $1
          AND r.status = 'accepted'
          AND r.decision_sent_at IS NOT NULL
        ORDER BY r.id DESC`,
        [userId],
      ),
      pool.query(
        `SELECT purpose, serial_number
         FROM wallet_passes
        WHERE user_id = $1 AND platform = 'apple' AND status <> 'voided'`,
        [userId],
      ),
      hasEventAccess(pool, userId),
    ]);
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  return {
    userId: row.id as number,
    // A `tickets` row is permanent once issued (plan/07 invariant 10), but it
    // only gets served here while the person currently holds event access —
    // otherwise a declined/revoked spot would keep showing a live QR/ticket.
    ticketToken: eventAccess ? ((row.token as string | null) ?? null) : null,
    badgeId: (row.badge_id as string | null) ?? null,
    applePassTypeIdentifier: PASS_TYPE_IDENTIFIER,
    // H28: the pass type identifier is shared by every attendee. The serial
    // number is the account-specific identity Wallet needs when more than one
    // hackOS pass is installed on the device.
    applePassSerialNumbers: {
      ticket:
        (applePassRows.find((pass: { purpose: string }) => pass.purpose === "ticket")
          ?.serial_number as string | undefined) ?? null,
      badge:
        (applePassRows.find((pass: { purpose: string }) => pass.purpose === "badge")
          ?.serial_number as string | undefined) ?? null,
    },
    acceptedSpots: acceptedRows.map((accepted) => ({
      responseId: accepted.response_id as number,
      applicationName: accepted.application_name as string,
      applicationType: accepted.application_type as string,
      expiresAt: accepted.expires_at ? (accepted.expires_at as Date).toISOString() : null,
    })),
  };
}
