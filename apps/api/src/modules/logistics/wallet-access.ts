import { randomBytes } from "node:crypto";
import type pg from "pg";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { UnauthorizedError } from "../../lib/errors.js";
import type { Purpose } from "./wallet-passes.js";

/**
 * Scoped wallet-pass credentials (H15 + H28, issue #369).
 *
 * The acceptance email's confirmation token is an identity assertion, not a
 * session: clicking "Accept my spot" must let that person put their ticket in
 * Apple/Google Wallet without ever signing in, and without the link granting
 * any other access. Confirming therefore mints one of these — a random,
 * short-lived token whose entire authority is "build the <purpose> pass of
 * user X". It grants no capabilities, reads nothing else, and dies on its own.
 *
 * Deliberately multi-use inside its window: adding the pass to both Apple and
 * Google Wallet, or retrying after a failed download, are the normal case.
 */

/** How long a scoped wallet token stays usable after it is minted. */
export const WALLET_ACCESS_TTL_MINUTES = 60;

export interface WalletAccessGrant {
  token: string;
  expiresAt: Date;
}

/**
 * Mints a scoped token for (user, purpose). Runs on the caller's client so it
 * commits atomically with the domain write that justified it (the confirm).
 */
export async function issueWalletAccessToken(
  client: pg.PoolClient,
  userId: number,
  purpose: Purpose,
): Promise<WalletAccessGrant> {
  // H54: the scoped token is still a credential. Serialize its issuance with
  // account removal so a pending account cannot mint a last-minute Wallet
  // link after its sessions and existing tokens were revoked.
  const active = await client.query(
    `SELECT 1 FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [userId],
  );
  if (!active.rows[0]) throw new UnauthorizedError("Account is closed or being removed");
  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query(
    `INSERT INTO wallet_access_tokens (token, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     RETURNING expires_at`,
    [token, userId, purpose, WALLET_ACCESS_TTL_MINUTES],
  );
  // H53: issuing a credential is auditable on its own, separate from the
  // confirm that triggered it.
  await audit(client, {
    actorId: userId,
    entityType: "wallet_access_token",
    entityId: token.slice(0, 8),
    action: "issued",
    source: "email_link",
    after: { userId, purpose },
  });
  return { token, expiresAt: rows[0].expires_at as Date };
}

/**
 * Resolves a scoped token to its user, or throws. The purpose must match what
 * the token was minted for: a ticket token can never fetch a badge pass.
 */
export async function resolveWalletAccessToken(
  token: string,
  purpose: Purpose,
): Promise<{ userId: number }> {
  const { rows } = await pool.query(
    `SELECT wat.user_id FROM wallet_access_tokens wat
       JOIN users u ON u.id = wat.user_id
      WHERE wat.token = $1 AND wat.purpose = $2 AND wat.expires_at > now()
        AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
    [token, purpose],
  );
  if (!rows[0]) throw new UnauthorizedError("Wallet link is invalid or has expired");
  return { userId: rows[0].user_id as number };
}

/** Housekeeping for expired rows; safe to call from anywhere. */
export async function purgeExpiredWalletAccessTokens(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM wallet_access_tokens WHERE expires_at < now() - interval '1 day'`,
  );
  return rowCount ?? 0;
}
