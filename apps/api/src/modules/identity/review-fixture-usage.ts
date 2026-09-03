import type { Queryable } from "../../db/pool.js";

/**
 * Record only that the currently provisioned synthetic credential was used,
 * keeping the most recent trusted request IP alongside the timestamp.
 * The registry pointer is deliberately not an identity bridge: account
 * removal nulls it, and the signal carries no password, PIN, user-agent or
 * user response value.
 */
export async function recordReviewFixtureAuthentication(
  db: Queryable,
  email: string,
  ip: string | null,
): Promise<void> {
  await db.query(
    `UPDATE review_fixture_accounts AS fixture
        SET last_authenticated_at = clock_timestamp(),
            last_authenticated_ip = $2,
            updated_at = clock_timestamp()
       FROM users AS user_account
      WHERE fixture.user_id = user_account.id
        AND user_account.is_test_account = true
        AND lower(user_account.email) = lower($1)`,
    [email, ip],
  );
}

/** Clear the bounded signal before a fixture user is removed. */
export async function clearReviewFixtureAuthentication(
  db: Queryable,
  userId: number,
): Promise<void> {
  await db.query(
    `UPDATE review_fixture_accounts
        SET user_id = NULL,
            last_authenticated_at = NULL,
            last_authenticated_ip = NULL
      WHERE user_id = $1`,
    [userId],
  );
}
