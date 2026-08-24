import { pool, type Queryable } from "../../db/pool.js";
import { GROUP_SIBLING_CHALLENGE_IDS_SQL } from "./groups.js";

/**
 * "Has anyone actually been judged yet?" — the single question behind every
 * lock on this surface (H46).
 *
 * The judging form and the shared-vs-per-challenge choice both stay editable
 * for as long as changing them cannot invalidate an answer somebody already
 * gave. That moment is the **first submitted evaluation**, not the scheduled
 * start of judging and not the generation of a queue: an event whose queues
 * are built and whose teams are lining up has nothing to lose from a
 * corrected question or a merge, and organisers routinely fix both in the
 * last minutes before the first team walks in.
 *
 * Scope is the **queue group**, because that is what a judging form belongs
 * to: once one challenge of a shared queue has an evaluation, the merged form
 * behind it is frozen for all of them.
 *
 * "Evaluated" is a submitted `attempt_review`, or a `completed` queue entry —
 * the second covers a presentation an operator closed by hand without the
 * panel writing a review.
 */
export async function evaluationStarted(client: Queryable, challengeId: number): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM queue_entries qe
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.challenge_id IN (${GROUP_SIBLING_CHALLENGE_IDS_SQL})
        AND (qe.status = 'completed' OR ar.status = 'submitted')
      LIMIT 1`,
    [challengeId],
  );
  return rows.length > 0;
}

/** {@link evaluationStarted} for a whole set of challenges at once. */
export async function anyEvaluationStarted(
  client: Queryable,
  challengeIds: number[],
): Promise<boolean> {
  if (challengeIds.length === 0) return false;
  const { rows } = await client.query(
    `SELECT 1
       FROM queue_entries qe
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.challenge_id = ANY($1::int[])
        AND (qe.status = 'completed' OR ar.status = 'submitted')
      LIMIT 1`,
    [challengeIds],
  );
  return rows.length > 0;
}

/**
 * Lock every queue entry whose evaluation could freeze the named challenges.
 * Queue-group configuration takes its group locks first and these entry locks
 * second; evaluation submission follows the same order via
 * {@link lockQueueGroupForEntry}. Once this returns, the following
 * `anyEvaluationStarted` check cannot become stale before the transaction
 * commits (H46, plan/07 §2).
 */
export async function lockEvaluationEntriesForChallenges(
  client: Queryable,
  challengeIds: number[],
): Promise<void> {
  if (challengeIds.length === 0) return;
  await client.query(
    `SELECT qe.id
       FROM queue_entries qe
      WHERE qe.challenge_id = ANY($1::int[])
      ORDER BY qe.id
      FOR UPDATE`,
    [challengeIds],
  );
}

/** Lock every entry currently belonging to one queue group, in id order. */
export async function lockEvaluationEntriesForGroup(
  client: Queryable,
  queueGroupId: number,
): Promise<void> {
  await client.query(
    `SELECT qe.id
       FROM queue_group_challenges qgc
       JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
      WHERE qgc.queue_group_id = $1
      ORDER BY qe.id
      FOR UPDATE OF qe`,
    [queueGroupId],
  );
}

/**
 * Lock the queue group that owns an entry before the entry itself is locked.
 *
 * A concurrent merge may move the challenge and delete its former group while
 * this statement waits. PostgreSQL can then return no row from the original
 * snapshot, so retry once with a fresh statement snapshot to lock the new
 * group. A missing entry is left for the caller's normal not-found check.
 */
export async function lockQueueGroupForEntry(client: Queryable, entryId: number): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await client.query(
      `SELECT qg.id
         FROM queue_entries qe
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN queue_groups qg ON qg.id = qgc.queue_group_id
        WHERE qe.id = $1
        FOR UPDATE OF qg`,
      [entryId],
    );
    if (result.rowCount) return;
  }
}

/**
 * Whether a challenge's judging panel may still be edited. Replaces the old
 * schedule-time lock: a panel freezes when its queue has produced its first
 * evaluation, whenever that happens to be.
 */
export function challengePanelLocked(challengeId: number): Promise<boolean> {
  return evaluationStarted(pool, challengeId);
}
