import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { queueFixtureMarker } from "./broadcast.js";
import { isRepoBlockedByBusyMember } from "./guard.js";
import { notifyTeamPreCall } from "./notify.js";
import { callNextForRoom } from "./service.js";

/**
 * Queue pump (plan/07 §5.1). For every non-paused room, top up `called`
 * entries up to room_queue_state.max_in_waiting_area from the shared
 * challenge queue, honouring position/priority and the H30 member-busy
 * guard (all inside callNextForRoom). Challenges whose sponsor opted out of
 * the live queue never block anything here because they were never `enqueue`d
 * in the first place (queue_entries only exist for challenges an admin
 * explicitly enqueued).
 *
 * H29/H35 (#544): automatic work is derived from the active room state and
 * judging schedule. Manual queue actions remain available outside the window.
 */
export const QUEUE_PUMP_QUEUE_NAME = "queue-pump";

/**
 * Top up a SINGLE room's `called` buffer to `max_in_waiting_area` from its
 * shared challenge queue — the same fill loop as pumpTick, scoped to one room
 * so a freed slot refills instantly instead of waiting for the 5s tick
 * (H29/H30/H35, plan/07 §5.1). Only non-paused rooms auto-fill (mirrors the
 * pump's room filter); an H35-paused room is a no-op.
 *
 * MUST run AFTER any surrounding transaction has committed: callNextForRoom
 * opens its own withTransaction, so never call this inside an open one.
 */
export async function topUpRoom(roomId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1
       FROM room_queue_state rqs
       JOIN rooms r ON r.id = rqs.room_id
       JOIN queue_settings qs ON qs.id = 1
      WHERE rqs.room_id = $1
        AND rqs.is_paused = false
        AND (qs.schedule_start_at IS NULL OR qs.schedule_start_at <= now())
        AND (qs.schedule_end_at IS NULL OR qs.schedule_end_at > now())`,
    [roomId],
  );
  if (rows.length === 0) return; // inactive, paused, unknown, or outside judging window

  // callNextForRoom is the atomic, race-safe unit — looping here just drains
  // the room's slack until full or nobody eligible.
  for (let i = 0; i < 50; i++) {
    let entry: Awaited<ReturnType<typeof callNextForRoom>>;
    try {
      entry = await callNextForRoom(null, roomId, { force: false, automatic: true });
    } catch (err) {
      if (err instanceof ConflictError) break; // full or paused mid-loop
      // A fire-and-forget refill can start just before its room is removed.
      // That is normal lifecycle cleanup, not an operator-visible failure; in
      // particular, it must not leave a rejected task behind during test
      // fixture teardown.
      if (err instanceof NotFoundError) return;
      throw err;
    }
    if (!entry) break;
  }
}

/**
 * Top up a room right after a slot-freeing transition commits (H29/H35). Any
 * error is swallowed and logged so it can never fail the user's original
 * action; the periodic pump remains the backstop.
 *
 * In production this is fire-and-forget — the caller's `await` resolves
 * immediately and the fill runs in the background, so the HTTP request never
 * waits on it. Under test we await the fill so integration assertions observe
 * the settled queue deterministically (no dangling cross-test work).
 */
export async function scheduleTopUp(roomId: number): Promise<void> {
  const done = topUpRoom(roomId).catch((err) => {
    console.error(`[queue] topUpRoom(${roomId}) failed`, err);
  });
  if (config.isTest) await done;
}

export async function pumpTick(): Promise<void> {
  const { rows: rooms } = await pool.query(
    `SELECT rqs.room_id AS id
       FROM room_queue_state rqs
       JOIN rooms r ON r.id = rqs.room_id
       JOIN queue_settings qs ON qs.id = 1
      WHERE rqs.is_paused = false
        AND (qs.schedule_start_at IS NULL OR qs.schedule_start_at <= now())
        AND (qs.schedule_end_at IS NULL OR qs.schedule_end_at > now())`,
  );

  for (const room of rooms as { id: number }[]) {
    await topUpRoom(room.id);
  }

  await emitPreCallWarnings();
}

type PreCallClaim = {
  id: number;
  challenge_id: number;
  repo_id: number;
  eta_minutes: number;
};

/**
 * H38: claim one logical team's pre-call cycle from a shared queue.
 *
 * The group row serialises all pump workers for a merged queue. Its entries
 * are then locked in id order before the existing H30 repo/member advisory
 * lock is acquired, matching call_next's entry-before-repo lock order. The
 * canonical line item, rank and ETA are all recomputed after those locks; the
 * final UPDATE claims every waiting sibling but returns only the canonical
 * row, which is the only row allowed to drive the notification.
 */
async function claimPreCall(queueGroupId: number, repoId: number): Promise<PreCallClaim | null> {
  return withTransaction(async (client) => {
    const { rows: groupRows } = await client.query(
      `SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`,
      [queueGroupId],
    );
    if (groupRows.length === 0) return null;

    const { rows: settingsRows } = await client.query(
      `SELECT pre_call_notification_eta_minutes,
              (schedule_start_at IS NULL OR schedule_start_at <= now())
              AND (schedule_end_at IS NULL OR schedule_end_at > now()) AS window_open
         FROM queue_settings WHERE id = 1 FOR SHARE`,
    );
    const settings = settingsRows[0] as
      | { pre_call_notification_eta_minutes: number; window_open: boolean }
      | undefined;
    if (!settings?.window_open) return null;

    // Resolve the complete graph after the group lock. A mixed or markerless
    // graph must never fall back to the real notification path.
    const groupMarker = await queueFixtureMarker(client, "queueGroup", queueGroupId);
    if (groupMarker === null) return null;

    // The outer group/repo snapshot can race room pause, unassignment, or
    // teardown. Lock every currently serving room state before checking the
    // gate so pauseRoom cannot commit between this read and the precall claim.
    // The queue-group lock is already held, which also keeps setQueueGroupRooms
    // from changing the serving set while these state rows are acquired.
    const { rows: servingRooms } = await client.query<{ room_id: number; is_paused: boolean }>(
      `SELECT rqs.room_id, rqs.is_paused
         FROM room_queue_groups rqg
         JOIN room_queue_state rqs ON rqs.room_id = rqg.room_id
        WHERE rqg.queue_group_id = $1
        ORDER BY rqs.room_id
        FOR UPDATE OF rqs`,
      [queueGroupId],
    );
    if (!servingRooms.some((room) => room.is_paused === false)) return null;

    // Lock every entry in the group before resolving the canonical rank. This
    // keeps a concurrent call/requeue from changing the line between the
    // snapshot and claim, while preserving the id-ordered lock discipline of
    // queue ordering and the call_next transition.
    await client.query(
      `SELECT qe.id
         FROM queue_group_challenges qgc
         JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
        WHERE qgc.queue_group_id = $1
        ORDER BY qe.id
        FOR UPDATE`,
      [queueGroupId],
    );

    // A queue entry can be inserted while the first marker inspection is in
    // progress. Re-resolve after taking the entry locks so a newly mixed graph
    // fails closed before any state or notification is produced.
    if ((await queueFixtureMarker(client, "queueGroup", queueGroupId)) !== groupMarker) {
      return null;
    }

    // This acquires H30's repo/member advisory locks and rechecks active
    // entries outside this group. A team that is already busy elsewhere must
    // not be warned as if it were approaching this queue.
    if (await isRepoBlockedByBusyMember(client, repoId, { fixtureMarker: groupMarker })) {
      return null;
    }

    const { rows: canonicalRows } = await client.query<{
      id: number;
      challenge_id: number;
      repo_id: number;
      position: number | null;
      rank: number;
    }>(
      `WITH group_waiting AS (
         SELECT qe.id, qe.challenge_id, qe.repo_id, qe.position, qe.precalled_at,
                ROW_NUMBER() OVER (
                  PARTITION BY qe.repo_id
                  ORDER BY qe.position ASC NULLS LAST, qe.id ASC
                ) AS repo_rank
           FROM queue_entries qe
           JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
           JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
           JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
          WHERE qgc.queue_group_id = $1
            AND qe.status = 'waiting'
       ), ranked AS MATERIALIZED (
         SELECT gw.id, gw.challenge_id, gw.repo_id, gw.position,
                ROW_NUMBER() OVER (
                  ORDER BY gw.position ASC NULLS LAST, gw.id ASC
                ) AS rank
           FROM group_waiting gw
          WHERE gw.repo_rank = 1
            AND NOT EXISTS (
              SELECT 1
                FROM queue_entries active
                JOIN queue_group_challenges active_qgc
                  ON active_qgc.challenge_id = active.challenge_id
               WHERE active_qgc.queue_group_id = $1
                 AND active.repo_id = gw.repo_id
                 AND active.status IN ('called', 'in_room', 'presenting', 'completed')
            )
       )
       SELECT ranked.id, ranked.challenge_id, ranked.repo_id, ranked.position, ranked.rank
         FROM ranked
        WHERE ranked.repo_id = $3
          AND NOT EXISTS (
            SELECT 1
              FROM queue_entries already
              JOIN queue_group_challenges already_qgc
                ON already_qgc.challenge_id = already.challenge_id
             WHERE already_qgc.queue_group_id = $1
               AND already.repo_id = ranked.repo_id
               AND already.status = 'waiting'
               AND already.precalled_at IS NOT NULL
          )
        ORDER BY rank ASC
        LIMIT 1`,
      [queueGroupId, groupMarker, repoId],
    );
    const canonical = canonicalRows[0];
    if (!canonical) return null;

    // Pace is a property of the shared queue, not an individual challenge.
    // Read it through the locked transaction client so rank and ETA use one
    // coherent snapshot of the queue's current serving-room graph.
    const { rows: paceRows } = await client.query(
      `SELECT COALESCE(AVG(rqs.desired_minutes_per_team), 8) AS avg,
              COUNT(*)::int AS rooms
         FROM room_queue_groups rqg
         JOIN room_queue_state rqs
           ON rqs.room_id = rqg.room_id
          AND rqs.is_paused = false
        WHERE rqg.queue_group_id = $1`,
      [queueGroupId],
    );
    const averageMinutes = Number(paceRows[0]?.avg ?? 8);
    const roomCount = Math.max(1, Number(paceRows[0]?.rooms ?? 0));
    const etaMinutes = canonical.rank * (averageMinutes / roomCount);
    const threshold = Number(settings.pre_call_notification_eta_minutes ?? 10);
    if (etaMinutes > threshold) return null;

    // Claim every still-waiting sibling in the same group/repo, but return
    // only the best row after the UPDATE. The status + NULL predicates make
    // this atomic with respect to any transition that raced the outer scan.
    const { rows: claimedRows } = await client.query<PreCallClaim>(
      `WITH claimable AS (
         SELECT qe.id
           FROM queue_entries qe
           JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
           JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
           JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
          WHERE qgc.queue_group_id = $1
            AND qe.repo_id = $3
            AND qe.status = 'waiting'
            AND qe.precalled_at IS NULL
       ), claimed AS (
         UPDATE queue_entries qe
            SET precalled_at = now()
           FROM claimable c
          WHERE qe.id = c.id
            AND qe.status = 'waiting'
            AND qe.precalled_at IS NULL
          RETURNING qe.id, qe.challenge_id, qe.repo_id, qe.position
       )
       SELECT id, challenge_id, repo_id,
              $4::double precision AS eta_minutes
         FROM claimed
        ORDER BY position ASC NULLS LAST, id ASC
        LIMIT 1`,
      [queueGroupId, groupMarker, repoId, etaMinutes],
    );
    const claimed = claimedRows[0] ?? null;
    if (!claimed) return null;

    // Keep the group/repo cycle serialized through the notification enqueue:
    // no second worker can observe this cycle half-finished, and the payload
    // is built exclusively from the canonical row returned by the claim.
    await notifyTeamPreCall(client, {
      entryId: claimed.id,
      challengeId: claimed.challenge_id,
      repoId: claimed.repo_id,
      etaMinutes: Math.round(claimed.eta_minutes),
    });
    return claimed;
  });
}

/** H38 pre-aviso: notify once per call cycle when ETA <= queue_settings.pre_call_notification_eta_minutes. */
async function emitPreCallWarnings(): Promise<void> {
  const settings = (
    await pool.query(
      `SELECT (schedule_start_at IS NULL OR schedule_start_at <= now())
              AND (schedule_end_at IS NULL OR schedule_end_at > now()) AS window_open
         FROM queue_settings WHERE id = 1`,
    )
  ).rows[0];
  if (!settings?.window_open) return;

  // The group/repo list is only work discovery. Every candidate is re-read
  // and claimed under the group lock, so this snapshot may safely go stale.
  const { rows: groupRepos } = await pool.query<{ queue_group_id: number; repo_id: number }>(
    `SELECT DISTINCT qgc.queue_group_id, qe.repo_id
       FROM queue_group_challenges qgc
       JOIN room_queue_groups rqg ON rqg.queue_group_id = qgc.queue_group_id
       JOIN room_queue_state rqs ON rqs.room_id = rqg.room_id AND rqs.is_paused = false
       JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
                            AND qe.status = 'waiting'`,
  );

  for (const { queue_group_id: queueGroupId, repo_id: repoId } of groupRepos) {
    await claimPreCall(Number(queueGroupId), Number(repoId));
  }
}

registerWorker(QUEUE_PUMP_QUEUE_NAME, async () => {
  await pumpTick();
});

/** Schedules the repeatable BullMQ job. Skipped in tests — pumpTick() is called/asserted directly there. */
export async function scheduleQueuePump(intervalMs = 5000): Promise<void> {
  await getQueue(QUEUE_PUMP_QUEUE_NAME).add(
    "tick",
    {},
    { repeat: { every: intervalMs }, jobId: "queue-pump-tick" },
  );
}
