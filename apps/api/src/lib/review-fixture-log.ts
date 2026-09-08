import type { Queryable } from "../db/pool.js";

export type ReviewFixtureLogContext = {
  fixtureKey: string;
  userId: number;
  email: string;
};

/** Resolve the currently registered synthetic account for request logging. */
export async function findReviewFixtureByUserId(
  db: Queryable,
  userId: number,
): Promise<ReviewFixtureLogContext | null> {
  const { rows } = await db.query<ReviewFixtureLogContext>(
    `SELECT fixture.fixture_key AS "fixtureKey",
            fixture.user_id AS "userId",
            account.email
       FROM review_fixture_accounts fixture
       JOIN users account ON account.id = fixture.user_id
      WHERE fixture.user_id = $1
        AND account.is_test_account = true
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Resolve a stable synthetic login address before Better Auth handles it. */
export async function findReviewFixtureByEmail(
  db: Queryable,
  email: string,
): Promise<ReviewFixtureLogContext | null> {
  const { rows } = await db.query<ReviewFixtureLogContext>(
    `SELECT fixture.fixture_key AS "fixtureKey",
            fixture.user_id AS "userId",
            account.email
       FROM review_fixture_accounts fixture
       JOIN users account ON account.id = fixture.user_id
      WHERE lower(account.email) = lower($1)
        AND account.is_test_account = true
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}
