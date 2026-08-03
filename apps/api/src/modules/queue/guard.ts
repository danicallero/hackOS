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
 */
const H30_LOCK_NAMESPACE = 815_030;

export async function isRepoBlockedByBusyMember(
  client: Queryable,
  repoId: number,
  opts: { roomId?: number | null; excludeEntryId?: number | null } = {},
): Promise<boolean> {
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
                              AND qe.status IN ('called', 'in_room', 'presenting')
      WHERE candidate.repo_id = $1
        AND ($2::int IS NULL OR qe.assigned_room_id IS DISTINCT FROM $2::int)
        AND ($3::int IS NULL OR qe.id <> $3::int)
      LIMIT 1`,
    [repoId, opts.roomId ?? null, opts.excludeEntryId ?? null],
  );
  return rows.length > 0;
}
