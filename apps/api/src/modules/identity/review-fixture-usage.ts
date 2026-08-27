import type { Queryable } from "../../db/pool.js";

/**
 * Record only that the currently provisioned synthetic credential was used.
 * The registry pointer is deliberately not an identity bridge: account
 * removal nulls it, and the timestamp carries no password, PIN, IP or user
 * response value.
 */
export async function recordReviewFixtureAuthentication(
  db: Queryable,
  email: string,
): Promise<void> {
  await db.query(
    `UPDATE review_fixture_accounts AS fixture
        SET last_authenticated_at = clock_timestamp(),
            updated_at = clock_timestamp()
       FROM users AS user_account
      WHERE fixture.user_id = user_account.id
        AND user_account.is_test_account = true
        AND lower(user_account.email) = lower($1)`,
    [email],
  );
}
