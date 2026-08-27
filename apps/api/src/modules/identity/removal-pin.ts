import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError, TooManyRequestsError } from "../../lib/errors.js";
import { enqueueAuthEmail } from "./outbox.js";

const PIN_LENGTH = 6;
const PIN_TTL_MINUTES = 10;
const PIN_COOLDOWN_SECONDS = 60;
const MAX_PIN_ATTEMPTS = 5;
const REVOKED_DIGEST = "revoked";
const REVOKED_NONCE = "revoked";

export const REMOVAL_PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`);

type RemovalPinUser = {
  id: number;
  email: string;
  email_verified: boolean;
  name: string | null;
  language: string;
  account_state: "active" | "removal_pending";
  anonymized_at: Date | null;
};

function digestPin(userId: number, email: string, nonce: string, pin: string): string {
  // The server secret prevents an offline database reader from enumerating
  // the six-digit space. The short expiry, database attempt counter, and
  // per-user cooldown still enforce the online brute-force boundary.
  return createHmac("sha256", config.BETTER_AUTH_SECRET)
    .update(`hackos:account-removal-pin:v1:${userId}:${email}:${nonce}:${pin}`)
    .digest("hex");
}

function safeDigestEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function invalidateChallengeSql(): string {
  return `
    UPDATE account_removal_pin_challenges
       SET consumed_at = clock_timestamp(),
           pin_digest = $2,
           nonce = $3
     WHERE user_id = $1 AND consumed_at IS NULL`;
}

export type RemovalPinIssueResult =
  | { status: "sent"; expiresAt: string }
  | { status: "not_required" };

/** Issue a one-time PIN to the currently verified primary address. */
export async function issueRemovalPin(
  client: pg.PoolClient,
  userId: number,
): Promise<RemovalPinIssueResult> {
  const { rows } = await client.query<RemovalPinUser>(
    `SELECT id, email, email_verified, name, language, account_state, anonymized_at
       FROM users
      WHERE id = $1
      FOR UPDATE`,
    [userId],
  );
  const user = rows[0];
  if (user?.account_state !== "active" || user?.anonymized_at != null) {
    throw new NotFoundError("User not found");
  }
  if (!user.email_verified) return { status: "not_required" };

  const { rows: previous } = await client.query<{ created_at: Date }>(
    `SELECT created_at
       FROM account_removal_pin_challenges
      WHERE user_id = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [userId],
  );
  const latest = previous[0];
  const now = new Date();
  if (latest) {
    const retryAfter = Math.ceil(
      (new Date(latest.created_at).getTime() + PIN_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
    );
    if (retryAfter > 0) {
      throw new TooManyRequestsError(
        "A security PIN was sent recently. Check your email or try again later.",
        retryAfter,
      );
    }
  }

  await client.query(invalidateChallengeSql(), [userId, REVOKED_DIGEST, REVOKED_NONCE]);
  const pin = randomInt(0, 1_000_000).toString().padStart(PIN_LENGTH, "0");
  const nonce = randomBytes(16).toString("hex");
  const digest = digestPin(user.id, user.email, nonce, pin);
  const { rows: challengeRows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO account_removal_pin_challenges
       (user_id, email, pin_digest, nonce, expires_at)
     VALUES ($1, $2, $3, $4, clock_timestamp() + make_interval(mins => $5))
     RETURNING expires_at`,
    [user.id, user.email, digest, nonce, PIN_TTL_MINUTES],
  );
  const expiresAt = challengeRows[0]?.expires_at;
  if (!expiresAt) throw new Error("Account-removal PIN challenge was not created");

  // Do not let an older queued PIN arrive after this one. Already-delivered
  // mail cannot be recalled, but its challenge has been invalidated above.
  await client.query(
    `DELETE FROM notification_outbox
      WHERE user_id = $1
        AND category = 'auth'
        AND channel = 'email'
        AND payload->>'template' = 'auth.accountRemovalPin'
        AND status = 'queued'`,
    [user.id],
  );
  await enqueueAuthEmail(
    client,
    user.id,
    "auth.accountRemovalPin",
    { name: user.name, pin, expiresMinutes: PIN_TTL_MINUTES },
    { recipient: user.email, language: user.language },
  );
  await audit(client, {
    actorId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "removal_pin_requested",
    source: "self_service",
    after: { expiresAt },
  });
  return { status: "sent", expiresAt: expiresAt.toISOString() };
}

/** Consume and verify the PIN while the account-removal transaction owns the user lock. */
export async function consumeRemovalPin(
  client: pg.PoolClient,
  user: Pick<RemovalPinUser, "id" | "email" | "email_verified">,
  pin: string | undefined,
): Promise<void> {
  if (!user.email_verified) return;
  if (!pin || !REMOVAL_PIN_PATTERN.test(pin)) {
    throw new BadRequestError("Enter the security PIN sent to your verified email.", {
      code: "removal_pin_required",
    });
  }

  const { rows } = await client.query<{
    id: number;
    email: string;
    pin_digest: string;
    nonce: string;
    attempts: number;
    expires_at: Date;
  }>(
    `SELECT id, email, pin_digest, nonce, attempts, expires_at
       FROM account_removal_pin_challenges
      WHERE user_id = $1 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [user.id],
  );
  const challenge = rows[0];
  const now = new Date();
  if (!challenge || challenge.email !== user.email) {
    throw new BadRequestError("Request a new security PIN before continuing.", {
      code: "removal_pin_required",
    });
  }
  if (new Date(challenge.expires_at).getTime() <= now.getTime()) {
    await client.query(
      `UPDATE account_removal_pin_challenges
          SET consumed_at = clock_timestamp(), pin_digest = $2, nonce = $3
        WHERE id = $1`,
      [challenge.id, REVOKED_DIGEST, REVOKED_NONCE],
    );
    throw new BadRequestError("That security PIN has expired. Request a new one.", {
      code: "removal_pin_expired",
    });
  }

  const expected = digestPin(user.id, user.email, challenge.nonce, pin);
  if (!safeDigestEqual(challenge.pin_digest, expected)) {
    const attempts = challenge.attempts + 1;
    await client.query(
      `UPDATE account_removal_pin_challenges
          SET attempts = $2::smallint,
              consumed_at = CASE WHEN $2::smallint >= $3::smallint THEN clock_timestamp() ELSE consumed_at END,
              pin_digest = CASE WHEN $2::smallint >= $3::smallint THEN $4 ELSE pin_digest END,
              nonce = CASE WHEN $2::smallint >= $3::smallint THEN $5 ELSE nonce END
        WHERE id = $1`,
      [challenge.id, attempts, MAX_PIN_ATTEMPTS, REVOKED_DIGEST, REVOKED_NONCE],
    );
    throw new BadRequestError("The security PIN is incorrect.", {
      code: "removal_pin_invalid",
    });
  }

  await client.query(
    `UPDATE account_removal_pin_challenges
        SET consumed_at = clock_timestamp(), pin_digest = $2, nonce = $3
      WHERE id = $1`,
    [challenge.id, REVOKED_DIGEST, REVOKED_NONCE],
  );
}
