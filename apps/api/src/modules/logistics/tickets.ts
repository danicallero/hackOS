import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";

/**
 * Creates the permanent entrance credential for any attendee category. The
 * unique user key makes repeated role transitions safe (plan/07 invariant 10).
 */
export async function issueTicket(client: pg.PoolClient, userId: number): Promise<string> {
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

export async function ticketQrPayload(userId: number) {
  const [{ rows }, { rows: acceptedRows }] = await Promise.all([
    pool.query(
      `SELECT u.id, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1`,
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
  ]);
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  return {
    userId: row.id as number,
    ticketToken: (row.token as string | null) ?? null,
    badgeId: (row.badge_id as string | null) ?? null,
    acceptedSpots: acceptedRows.map((accepted) => ({
      responseId: accepted.response_id as number,
      applicationName: accepted.application_name as string,
      applicationType: accepted.application_type as string,
      expiresAt: accepted.expires_at ? (accepted.expires_at as Date).toISOString() : null,
    })),
  };
}
