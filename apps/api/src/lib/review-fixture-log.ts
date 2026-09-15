import type { Queryable } from "../db/pool.js";

export type ReviewFixtureLogContext = {
  fixtureKey: string;
  userId: number;
  email: string;
};

const FIXTURE_CACHE_TTL_MS = 30_000;
let fixtureCache: {
  expiresAt: number;
  byUserId: Map<number, ReviewFixtureLogContext>;
} | null = null;
let fixtureCacheLoad: Promise<Map<number, ReviewFixtureLogContext>> | null = null;

/** Invalidate after regeneration so the next request sees the new identities. */
export function invalidateReviewFixtureCache(): void {
  fixtureCache = null;
}

async function fixtureByUserId(db: Queryable): Promise<Map<number, ReviewFixtureLogContext>> {
  if (fixtureCache && fixtureCache.expiresAt > Date.now()) return fixtureCache.byUserId;
  if (!fixtureCacheLoad) {
    fixtureCacheLoad = db
      .query<ReviewFixtureLogContext>(
        `SELECT fixture.fixture_key AS "fixtureKey",
                fixture.user_id AS "userId",
                account.email
           FROM review_fixture_accounts fixture
           JOIN users account ON account.id = fixture.user_id
          WHERE fixture.user_id IS NOT NULL
            AND account.is_test_account = true`,
      )
      .then(({ rows }) => {
        const byUserId = new Map(rows.map((row) => [row.userId, row]));
        fixtureCache = { byUserId, expiresAt: Date.now() + FIXTURE_CACHE_TTL_MS };
        return byUserId;
      })
      .finally(() => {
        fixtureCacheLoad = null;
      });
  }
  return fixtureCacheLoad;
}

/** Resolve the currently registered synthetic account for request logging. */
export async function findReviewFixtureByUserId(
  db: Queryable,
  userId: number,
): Promise<ReviewFixtureLogContext | null> {
  return (await fixtureByUserId(db)).get(userId) ?? null;
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
