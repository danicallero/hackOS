import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { queueFixtureMarker } from "./broadcast.js";
import { notifyTeamPreCall } from "./notify.js";
import { challengeEtaMinutesPerSlot } from "./reads.js";
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

/** H38 pre-aviso: notify once per call cycle when ETA <= queue_settings.pre_call_notification_eta_minutes. */
async function emitPreCallWarnings(): Promise<void> {
  const settings = (
    await pool.query(
      `SELECT pre_call_notification_eta_minutes,
              (schedule_start_at IS NULL OR schedule_start_at <= now())
              AND (schedule_end_at IS NULL OR schedule_end_at > now()) AS window_open
         FROM queue_settings WHERE id = 1`,
    )
  ).rows[0];
  if (!settings?.window_open) return;
  const threshold = settings?.pre_call_notification_eta_minutes ?? 10;

  const { rows: queueGroups } = await pool.query<{ queue_group_id: number }>(
    `SELECT DISTINCT qgc.queue_group_id
       FROM queue_group_challenges qgc
       JOIN room_queue_groups rqg ON rqg.queue_group_id = qgc.queue_group_id
       JOIN room_queue_state rqs ON rqs.room_id = rqg.room_id AND rqs.is_paused = false`,
  );

  for (const { queue_group_id: queueGroupId } of queueGroups) {
    // Resolve the complete graph once per shared queue. A challenge-by-
    // challenge loop can warn the same repo twice when it applied to two
    // challenges in one merged group, and a mixed graph must never fall back
    // to the real notification path.
    const groupMarker = await queueFixtureMarker(pool, "queueGroup", queueGroupId);
    if (groupMarker === null) continue;
    const { rows: waiting } = await pool.query<{
      id: number;
      challenge_id: number;
      repo_id: number;
      precalled_at: string | null;
      position: number | null;
      rank: number;
    }>(
      `WITH group_waiting AS (
         SELECT qe.id, qe.challenge_id, qe.repo_id, qe.precalled_at, qe.position,
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
            AND NOT EXISTS (
              SELECT 1
                FROM queue_entries active
                JOIN queue_group_challenges active_qgc
                  ON active_qgc.challenge_id = active.challenge_id
               WHERE active_qgc.queue_group_id = $1
                 AND active.repo_id = qe.repo_id
                 AND active.status IN ('called', 'in_room', 'presenting', 'completed')
            )
            AND NOT EXISTS (
              SELECT 1
                FROM queue_entries already
                JOIN queue_group_challenges already_qgc
                  ON already_qgc.challenge_id = already.challenge_id
               WHERE already_qgc.queue_group_id = $1
                 AND already.repo_id = qe.repo_id
                 AND already.status = 'waiting'
                 AND already.precalled_at IS NOT NULL
            )
       ), deduped AS (
         SELECT id, challenge_id, repo_id, precalled_at, position
           FROM group_waiting
          WHERE repo_rank = 1
       )
       SELECT id, challenge_id, repo_id, precalled_at, position,
              ROW_NUMBER() OVER (ORDER BY position ASC NULLS LAST, id ASC) AS rank
         FROM deduped
        ORDER BY position ASC NULLS LAST, id ASC`,
      [queueGroupId, groupMarker],
    );
    const firstChallengeId = waiting[0]?.challenge_id;
    if (firstChallengeId == null) continue;
    const perSlot = await challengeEtaMinutesPerSlot(firstChallengeId, groupMarker);
    for (const w of waiting as {
      id: number;
      challenge_id: number;
      repo_id: number;
      precalled_at: string | null;
      position: number | null;
      rank: number;
    }[]) {
      // Re-check the full entry/group/room graph before claiming the row. A
      // stale or mixed graph must not advance its pre-call state or notify a
      // participant from the wrong fixture boundary.
      if ((await queueFixtureMarker(pool, "entry", Number(w.id))) !== groupMarker) {
        continue;
      }
      const eta = w.rank * perSlot;
      if (w.precalled_at || eta > threshold) continue;
      // Atomically claim every still-waiting sibling for this repo in the
      // group, but notify only the row at the group's best position. The
      // status predicate closes the stale-row race where an operator calls or
      // requeues the team between the read above and this write. If another
      // pump instance wins first, all rows fail the predicate and no duplicate
      // notification is sent.
      const { rows: claimed } = await pool.query(
        `WITH claimable AS (
           SELECT qe.id,
                  ROW_NUMBER() OVER (ORDER BY qe.position ASC NULLS LAST, qe.id ASC) AS rank
             FROM queue_entries qe
             JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
             JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
             JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
            WHERE qgc.queue_group_id = $1
              AND qe.repo_id = $3
              AND qe.status = 'waiting'
              AND qe.precalled_at IS NULL
              AND NOT EXISTS (
                SELECT 1
                  FROM queue_entries active
                  JOIN queue_group_challenges active_qgc
                    ON active_qgc.challenge_id = active.challenge_id
                 WHERE active_qgc.queue_group_id = $1
                   AND active.repo_id = qe.repo_id
                   AND active.status IN ('called', 'in_room', 'presenting', 'completed')
              )
              AND NOT EXISTS (
                SELECT 1
                  FROM queue_entries already
                  JOIN queue_group_challenges already_qgc
                    ON already_qgc.challenge_id = already.challenge_id
                 WHERE already_qgc.queue_group_id = $1
                   AND already.repo_id = qe.repo_id
                   AND already.status = 'waiting'
                   AND already.precalled_at IS NOT NULL
              )
         ), claimed AS (
           UPDATE queue_entries qe
              SET precalled_at = now()
             FROM claimable c
            WHERE qe.id = c.id
              AND qe.status = 'waiting'
              AND qe.precalled_at IS NULL
            RETURNING qe.id, c.rank
         )
         SELECT id FROM claimed WHERE rank = 1`,
        [queueGroupId, groupMarker, w.repo_id],
      );
      if (claimed.length === 0) continue;
      await notifyTeamPreCall(pool, {
        entryId: w.id,
        challengeId: w.challenge_id,
        repoId: w.repo_id,
        etaMinutes: Math.round(eta),
      });
    }
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
