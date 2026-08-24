import type { Queryable } from "../../db/pool.js";
import { REPO_MEMBER_RELATION_SQL } from "./membership.js";

/**
 * H30 hard invariant: never call a team if any of its members is already
 * `called`, `in_room` or `presenting` in ANOTHER room. Membership includes the
 * authoritative submission row, a linked Devpost participant, and the primary
 * or verified-secondary email fallback used by the project/queue roster.
 * This includes another entry for the same repo when that project competes in
 * more than one challenge: a team cannot physically wait at two room doors at
 * once.
 *
 * Race note (plan/07 §2): row locks on the candidate entry are NOT enough —
 * two rooms calling two different repos that share a member would each lock
 * their own row, pass this check under read committed, and both commit.
 * `pg_advisory_xact_lock` on every member's user id (ascending, so lock
 * acquisition order is globally consistent and deadlock-free) serializes the
 * check across transactions: the second transaction blocks until the first
 * commits its transition, then sees the member as busy.
 *
 * The member-id lock alone is not sufficient on its own: if a repo has no
 * resolvable members at check time (e.g. its active submission was withdrawn
 * after the queue entry was created, or a Devpost email match briefly fails
 * to resolve), the member query returns zero rows, no lock is acquired, and
 * two rooms calling the SAME repo's two different challenge entries could
 * both pass. We additionally lock on the repo id itself (separate
 * namespace) and check the repo's own active entries directly, independent
 * of member resolution, so the guard can never be bypassed by an empty
 * membership set.
 */
const H30_LOCK_NAMESPACE = 815_030;
const H30_REPO_LOCK_NAMESPACE = 815_031;

export async function isRepoBlockedByBusyMember(
  client: Queryable,
  repoId: number,
  opts: {
    roomId?: number | null;
    excludeEntryId?: number | null;
    statuses?: readonly string[];
  } = {},
): Promise<boolean> {
  const statuses = opts.statuses ?? ["called", "in_room", "presenting"];
  await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [
    H30_REPO_LOCK_NAMESPACE,
    repoId,
  ]);
  await client.query(
    `SELECT pg_advisory_xact_lock($1::int, members.user_id)
       FROM (
         SELECT DISTINCT user_id
           FROM (${REPO_MEMBER_RELATION_SQL}) repo_members
          WHERE repo_id = $2
          ORDER BY user_id
       ) members`,
    [H30_LOCK_NAMESPACE, repoId],
  );
  const { rows } = await client.query(
    `WITH repo_members AS (${REPO_MEMBER_RELATION_SQL})
     SELECT 1
       FROM repo_members candidate
       JOIN repo_members active ON active.user_id = candidate.user_id
       JOIN queue_entries qe ON qe.repo_id = active.repo_id
                              AND qe.status = ANY($4::queue_status[])
      WHERE candidate.repo_id = $1
        AND ($2::int IS NULL OR qe.assigned_room_id IS DISTINCT FROM $2::int)
        AND ($3::int IS NULL OR qe.id <> $3::int)
     UNION ALL
     SELECT 1
       FROM queue_entries qe
      WHERE qe.repo_id = $1
        AND qe.status = ANY($4::queue_status[])
        AND ($2::int IS NULL OR qe.assigned_room_id IS DISTINCT FROM $2::int)
        AND ($3::int IS NULL OR qe.id <> $3::int)
      LIMIT 1`,
    [repoId, opts.roomId ?? null, opts.excludeEntryId ?? null, statuses],
  );
  return rows.length > 0;
}
