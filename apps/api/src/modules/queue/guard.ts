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

/** H30/H38: an ineligible project is never called, but it is not "busy" (#931). */
export async function isRepoIneligibleForJudging(
  client: Queryable,
  repoId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT eligible FROM project_reconciliation_state WHERE id=$1`,
    [repoId],
  );
  return rows[0]?.eligible === false;
}

/** The live entry that occupies one of the team's members elsewhere (H30). */
export interface BusyMemberEntry {
  entryId: number;
  roomId: number | null;
  roomName: string | null;
  status: string;
}

/**
 * Occupancy only: eligibility is a separate call-time rule
 * (`isRepoIneligibleForJudging`), so a move never reports an ineligible team
 * as busy (#931). Returns the blocking row so callers can name the room.
 */
export async function findBusyMemberEntry(
  client: Queryable,
  repoId: number,
  opts: {
    roomId?: number | null;
    excludeEntryId?: number | null;
    statuses?: readonly string[];
    fixtureMarker?: boolean;
  } = {},
): Promise<BusyMemberEntry | null> {
  const statuses = opts.statuses ?? ["called", "in_room", "presenting"];
  const fixtureMarker = opts.fixtureMarker ?? null;
  await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [
    H30_REPO_LOCK_NAMESPACE,
    repoId,
  ]);
  await client.query(
    `SELECT pg_advisory_xact_lock($1::int, members.user_id)
       FROM (
         SELECT DISTINCT user_id
           FROM (${REPO_MEMBER_RELATION_SQL}) repo_members
           JOIN users member_user ON member_user.id = repo_members.user_id
          WHERE repo_id = $2
            AND ($3::boolean IS NULL OR member_user.is_test_account = $3::boolean)
          ORDER BY user_id
       ) members`,
    [H30_LOCK_NAMESPACE, repoId, fixtureMarker],
  );
  const { rows } = await client.query<{
    entry_id: number;
    room_id: number | null;
    room_name: string | null;
    status: string;
  }>(
    `WITH repo_members AS (${REPO_MEMBER_RELATION_SQL}),
     candidate_members AS (
       SELECT user_id FROM repo_members
        WHERE repo_id = $1
          AND ($5::boolean IS NULL OR EXISTS (
            SELECT 1 FROM repos candidate_repo
             WHERE candidate_repo.id = $1
               AND candidate_repo.is_test_account = $5::boolean
          ))
     ),
     blocking AS (
       SELECT qe.id, qe.assigned_room_id, qe.status
         FROM candidate_members candidate
         JOIN repo_members active ON active.user_id = candidate.user_id
         JOIN queue_entries qe ON qe.repo_id = active.repo_id
       UNION
       SELECT qe.id, qe.assigned_room_id, qe.status
         FROM queue_entries qe
        WHERE qe.repo_id = $1
     )
     SELECT b.id AS entry_id, b.assigned_room_id AS room_id, r.name AS room_name,
            b.status::text AS status
       FROM blocking b
       JOIN queue_entries qe ON qe.id = b.id
       JOIN repos active_repo ON active_repo.id = qe.repo_id
                              AND ($5::boolean IS NULL OR active_repo.is_test_account = $5::boolean)
       JOIN challenges active_challenge ON active_challenge.id = qe.challenge_id
                                      AND ($5::boolean IS NULL OR active_challenge.is_test_account = $5::boolean)
       LEFT JOIN rooms r ON r.id = b.assigned_room_id
      WHERE b.status = ANY($4::queue_status[])
        AND ($2::int IS NULL OR b.assigned_room_id IS DISTINCT FROM $2::int)
        AND ($3::int IS NULL OR b.id <> $3::int)
      ORDER BY b.id
      LIMIT 1`,
    [repoId, opts.roomId ?? null, opts.excludeEntryId ?? null, statuses, fixtureMarker],
  );
  const row = rows[0];
  return row
    ? { entryId: row.entry_id, roomId: row.room_id, roomName: row.room_name, status: row.status }
    : null;
}
