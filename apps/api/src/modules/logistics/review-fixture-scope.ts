import type { Queryable } from "../../db/pool.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

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
 * Check whether an enterprise belongs to the synthetic graph.  Enterprises do
 * not carry their own marker: the marker is inherited from the sponsor user or
 * any challenge owned by one of its sponsors.  A mixed graph is an invariant
 * violation, not a reason to silently pick whichever marker happened to be
 * returned first.
 */
export async function assertFixtureEnterpriseScope(
  db: Queryable,
  actorId: number,
  enterpriseId: number,
): Promise<void> {
  const { rows } = await db.query<{
    has_synthetic: boolean;
    has_real: boolean;
  }>(
    `SELECT
       COALESCE(bool_or(marker), false) AS has_synthetic,
       COALESCE(bool_or(NOT marker), false) AS has_real
       FROM (
         SELECT u.is_test_account AS marker
           FROM sponsors s
           JOIN users u ON u.id = s.user_id
          WHERE s.enterprise_id = $1
         UNION ALL
         SELECT c.is_test_account AS marker
           FROM sponsors s
           JOIN challenges c ON c.author = s.id
          WHERE s.enterprise_id = $1
       ) markers`,
    [enterpriseId],
  );
  const marker = rows[0];
  if (marker?.has_synthetic && marker.has_real) {
    throw new ConflictError("Fixture markers must match across an enterprise graph", {
      code: "review_fixture_scope",
      enterpriseId,
    });
  }
  const isSynthetic = marker?.has_synthetic === true;
  const actorIsSynthetic = await isSyntheticOperator(db, actorId);
  if (isSynthetic !== actorIsSynthetic) {
    if (actorIsSynthetic) {
      throw new ForbiddenError("Synthetic operators may only access synthetic enterprise data.", {
        code: "review_fixture_scope",
      });
    }
    throw new NotFoundError("Enterprise not found");
  }
}

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
  let isSynthetic = false;
  if (resource === "challenge" || resource === "repo") {
    const table = resource === "challenge" ? "challenges" : "repos";
    const { rows } = await db.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM ${table} WHERE id = $1`,
      [resourceId],
    );
    isSynthetic = rows[0]?.is_test_account === true;
  } else if (resource === "entry") {
    const { rows } = await db.query<{
      challenge_is_test_account: boolean;
      repo_is_test_account: boolean;
    }>(
      `SELECT c.is_test_account AS challenge_is_test_account,
              r.is_test_account AS repo_is_test_account
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = $1`,
      [resourceId],
    );
    const row = rows[0];
    if (row && row.challenge_is_test_account !== row.repo_is_test_account) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        entryId: resourceId,
      });
    }
    isSynthetic = row?.challenge_is_test_account === true;
  } else {
    const join =
      resource === "room"
        ? `JOIN room_queue_groups rqg
             ON rqg.queue_group_id = qgc.queue_group_id
            AND rqg.room_id = $1`
        : "";
    const where = resource === "room" ? "" : "WHERE qgc.queue_group_id = $1";
    const { rows } = await db.query<{ has_synthetic: boolean; has_real: boolean }>(
      `SELECT COALESCE(bool_or(c.is_test_account), false) AS has_synthetic,
              COALESCE(bool_or(NOT c.is_test_account), false) AS has_real
         FROM queue_group_challenges qgc
         ${join}
         JOIN challenges c ON c.id = qgc.challenge_id
         ${where}`,
      [resourceId],
    );
    const row = rows[0];
    if (row?.has_synthetic && row.has_real) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource,
        resourceId,
      });
    }
    isSynthetic = row?.has_synthetic === true;
  }
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
