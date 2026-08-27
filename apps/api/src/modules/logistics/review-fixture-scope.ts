import type { Queryable } from "../../db/pool.js";
import { ForbiddenError } from "../../lib/errors.js";

/**
 * Synthetic App Store/QA operators are deliberately narrower than ordinary
 * capability holders. Their credentials may exercise the operational flows,
 * but only against synthetic subjects. This keeps a reviewer deployment safe
 * even if it is accidentally seeded with real event data.
 */
export async function isSyntheticOperator(db: Queryable, actorId: number): Promise<boolean> {
  const { rows } = await db.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [actorId],
  );
  return rows[0]?.is_test_account === true;
}

/** Enforce the synthetic-operator boundary for a subject-targeted operation. */
export async function assertFixtureSubjectScope(
  db: Queryable,
  actorId: number,
  subjectUserId: number,
): Promise<void> {
  const { rows } = await db.query<{
    actor_is_test_account: boolean;
    subject_is_test_account: boolean;
  }>(
    `SELECT actor.is_test_account AS actor_is_test_account,
            subject.is_test_account AS subject_is_test_account
       FROM users actor
       JOIN users subject ON subject.id = $2
      WHERE actor.id = $1`,
    [actorId, subjectUserId],
  );
  const row = rows[0];
  if (row?.actor_is_test_account && !row.subject_is_test_account) {
    throw new ForbiddenError("Review fixture operators may only act on test accounts", {
      code: "review_fixture_scope",
    });
  }
}

/** Return a safe SQL fragment for a global operational read. */
export async function fixtureReadFilter(
  db: Queryable,
  actorId: number | undefined,
  alias: string,
): Promise<string> {
  if (actorId == null || !(await isSyntheticOperator(db, actorId))) return "";
  return ` AND ${alias}.is_test_account = true`;
}
