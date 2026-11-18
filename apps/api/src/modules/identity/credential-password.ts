import { verifyPassword } from "better-auth/crypto";
import type { Queryable } from "../../db/pool.js";

/**
 * Whether `password` matches the user's Better Auth email/password credential.
 * Used to re-authenticate sensitive actions (H54 account removal, H28 signing
 * out other devices). A user without a credential password never matches.
 */
export async function matchesCredentialPassword(
  db: Queryable,
  userId: number,
  password: string,
): Promise<boolean> {
  const { rows } = await db.query<{ password: string }>(
    `SELECT password
       FROM accounts
      WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL
      ORDER BY id ASC
      LIMIT 1`,
    [userId],
  );
  const hash = rows[0]?.password;
  if (!hash) return false;
  try {
    return await verifyPassword({ hash, password });
  } catch {
    return false;
  }
}
