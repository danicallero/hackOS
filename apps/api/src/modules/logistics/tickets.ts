import { randomBytes } from "node:crypto";
import type pg from "pg";

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
