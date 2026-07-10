import type { Queryable } from "../../db/pool.js";

/**
 * H30 hard invariant: never call a team if any of its members (via
 * `submissions` of the repo being considered) is already `called`, `in_room`
 * or `presenting` in ANOTHER room. This includes another entry for the same
 * repo when that project competes in more than one challenge: a team cannot
 * physically wait at two room doors at once.
 *
 * Race note (plan/07 §2): row locks on the candidate entry are NOT enough —
 * two rooms calling two different repos that share a member would each lock
 * their own row, pass this check under read committed, and both commit.
 * `pg_advisory_xact_lock` on every member's user id (ascending, so lock
 * acquisition order is globally consistent and deadlock-free) serializes the
 * check across transactions: the second transaction blocks until the first
 * commits its transition, then sees the member as busy.
 */
const H30_LOCK_NAMESPACE = 815_030;

export async function isRepoBlockedByBusyMember(
  client: Queryable,
  repoId: number,
): Promise<boolean> {
  await client.query(
    `SELECT pg_advisory_xact_lock($1::int, user_id)
       FROM (SELECT DISTINCT user_id FROM submissions WHERE repo_id = $2 ORDER BY user_id) members`,
    [H30_LOCK_NAMESPACE, repoId],
  );
  const { rows } = await client.query(
    `SELECT 1
       FROM submissions s1
       JOIN submissions s2 ON s2.user_id = s1.user_id
       JOIN queue_entries qe ON qe.repo_id = s2.repo_id
                              AND qe.status IN ('called', 'in_room', 'presenting')
      WHERE s1.repo_id = $1
      LIMIT 1`,
    [repoId],
  );
  return rows.length > 0;
}
