import type { Queryable } from "../../db/pool.js";
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";

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

/**
 * Enforce the synthetic-operator boundary for a subject-targeted operation.
 * Ordinary event operators cannot discover synthetic subjects through a stale
 * id; the dedicated synthetic operator is restricted to synthetic subjects.
 */
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
  if (!row) throw new NotFoundError("User not found");
  if (row?.actor_is_test_account && !row.subject_is_test_account) {
    throw new ForbiddenError("Review fixture operators may only act on test accounts", {
      code: "review_fixture_scope",
    });
  }
  if (row && !row.actor_is_test_account && row.subject_is_test_account) {
    throw new NotFoundError("User not found");
  }
}

/** Return a safe SQL fragment for a global operational read. */
export async function fixtureReadFilter(
  db: Queryable,
  actorId: number | undefined,
  alias: string,
): Promise<string> {
  if (actorId == null) return "";
  const syntheticOperator = await isSyntheticOperator(db, actorId);
  return ` AND ${alias}.is_test_account = ${syntheticOperator ? "true" : "false"}`;
}

type FixtureQueueResource = "challenge" | "repo" | "entry" | "room" | "queueGroup";

/**
 * Keep synthetic queue/project ids out of global queue capabilities too. A
 * caller who guesses a fixture id must not be able to mutate or inspect it
 * through an ID-based queue route; the dedicated synthetic operator may only
 * reach marked queue data.
 */
export async function assertFixtureQueueScope(
  db: Queryable,
  actorId: number,
  resource: FixtureQueueResource,
  resourceId: number,
): Promise<void> {
  const queryByResource: Record<FixtureQueueResource, string> = {
    challenge: `SELECT is_test_account FROM challenges WHERE id = $1`,
    repo: `SELECT is_test_account FROM repos WHERE id = $1`,
    entry: `SELECT (c.is_test_account OR r.is_test_account) AS is_test_account
              FROM queue_entries qe
              JOIN challenges c ON c.id = qe.challenge_id
              JOIN repos r ON r.id = qe.repo_id
             WHERE qe.id = $1`,
    room: `SELECT EXISTS (
              SELECT 1
                FROM room_queue_groups rqg
                JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
                JOIN challenges c ON c.id = qgc.challenge_id
               WHERE rqg.room_id = $1 AND c.is_test_account = true
            ) AS is_test_account`,
    queueGroup: `SELECT EXISTS (
                   SELECT 1
                     FROM queue_group_challenges qgc
                     JOIN challenges c ON c.id = qgc.challenge_id
                    WHERE qgc.queue_group_id = $1 AND c.is_test_account = true
                 ) AS is_test_account`,
  };
  const { rows } = await db.query<{ is_test_account: boolean }>(queryByResource[resource], [
    resourceId,
  ]);
  const isSynthetic = rows[0]?.is_test_account === true;
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  if (isSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic queue data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Queue resource not found");
  }
}
