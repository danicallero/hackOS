import { randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { pool, type Queryable } from "../../db/pool.js";
import { BadRequestError, ConflictError, TooManyRequestsError } from "../../lib/errors.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { runAccountRemoval } from "./removal.js";

/**
 * "I didn't create this account" (H1, H54). Every verification reminder
 * carries a single-use link that lets the person behind the address delete an
 * account that was opened with it and never verified. The link replaces the
 * emailed security PIN of ordinary self-service removal (it was itself sent to
 * the unverified address, so a PIN would prove nothing), but the account's
 * current password is still required when the account has one: the link
 * alone only identifies the account. An account that never had a password has
 * nothing to re-enter, so it is deleted after the page's confirmation.
 *
 * Only accounts that are still unverified qualify. Once the address is
 * verified the link stops working and removal goes through the regular
 * PIN-protected flow.
 */

const TOKEN_TTL_DAYS = 30;
const PASSWORD_ATTEMPTS = { windowSeconds: 3600, max: 10 };

/** A web-app URL for `path`, tolerating a trailing slash on `WEB_URL`. */
export function webUrl(path: string): string {
  let base = config.WEB_URL;
  while (base.endsWith("/")) base = base.slice(0, -1);
  return `${base}${path}`;
}

/** Mints a removal link for an unverified account; call inside the reminder's transaction. */
export async function issueUnverifiedRemovalLink(
  db: Queryable,
  user: { id: number; email: string },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
     VALUES ($1, 'unverified_account_removal', $2, $3, now() + make_interval(days => $4))`,
    [token, user.email, user.id, TOKEN_TTL_DAYS],
  );
  return webUrl(`/delete-account?token=${token}`);
}

interface RemovalTarget {
  userId: number;
  email: string;
  passwordRequired: boolean;
}

function invalidLink(): BadRequestError {
  return new BadRequestError("This link is invalid or has expired.", {
    code: "removal_link_invalid",
  });
}

async function resolveTarget(token: string): Promise<RemovalTarget> {
  const { rows } = await pool.query<{
    user_id: number;
    email: string;
    email_verified: boolean;
    password_required: boolean;
  }>(
    `SELECT u.id AS user_id, u.email, u.email_verified,
            EXISTS (SELECT 1 FROM accounts a
                     WHERE a.user_id = u.id AND a.provider_id = 'credential'
                       AND a.password IS NOT NULL) AS password_required
       FROM email_verification_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token = $1
        AND t.type = 'unverified_account_removal'
        AND t.used_at IS NULL
        AND t.expires_at > now()
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL`,
    [token],
  );
  const row = rows[0];
  if (!row) throw invalidLink();
  if (row.email_verified) {
    throw new ConflictError("This account's email is already verified.", {
      code: "account_already_verified",
    });
  }
  return { userId: row.user_id, email: row.email, passwordRequired: row.password_required };
}

/** Which account the link would delete, so the page can ask for confirmation. */
export async function describeUnverifiedRemoval(
  token: string,
): Promise<{ email: string; passwordRequired: boolean }> {
  const { email, passwordRequired } = await resolveTarget(token);
  return { email, passwordRequired };
}

/** Deletes the account the token names after verifying its current password. */
export async function removeUnverifiedAccount(token: string, password?: string): Promise<void> {
  const target = await resolveTarget(token);
  const limit = await consumeRateLimit(
    "unverified-removal",
    String(target.userId),
    PASSWORD_ATTEMPTS,
  );
  if (!limit.allowed) {
    throw new TooManyRequestsError("Too many attempts — try again later.", limit.retryAfterSeconds);
  }
  // The password check and the verified-email re-check both run inside the
  // removal transaction under the user-row lock, so a concurrent verification
  // cannot slip past the PIN requirement.
  const result = await runAccountRemoval({
    targetId: target.userId,
    actorId: target.userId,
    source: "self_service",
    requestedAction: "delete",
    reauthenticationPassword: password,
    allowPasswordlessReauthentication: true,
  });
  if (result.status !== "completed") {
    throw new ConflictError("The account could not be deleted yet — try again later.");
  }
}
