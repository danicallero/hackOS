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

  const { rows: challengeIds } = await pool.query(
    `SELECT DISTINCT qe.challenge_id
       FROM queue_entries qe
       JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
       JOIN room_queue_groups rqg ON rqg.queue_group_id = qgc.queue_group_id
       JOIN rooms r ON r.id = rqg.room_id
       JOIN room_queue_state rqs ON rqs.room_id = r.id AND rqs.is_paused = false
      WHERE qe.status = 'waiting'`,
  );

  for (const { challenge_id: challengeId } of challengeIds as { challenge_id: number }[]) {
    const challengeMarker = await queueFixtureMarker(pool, "challenge", challengeId);
    if (challengeMarker === null) continue;
    const perSlot = await challengeEtaMinutesPerSlot(challengeId, challengeMarker);
    const { rows: waiting } = await pool.query(
      `SELECT id, repo_id, precalled_at,
              ROW_NUMBER() OVER (ORDER BY position ASC NULLS LAST, id ASC) AS rank
         FROM queue_entries
        WHERE challenge_id = $1 AND status = 'waiting'`,
      [challengeId],
    );
    for (const w of waiting as {
      id: number;
      repo_id: number;
      precalled_at: string | null;
      rank: number;
    }[]) {
      // Re-check the full entry/group/room graph before claiming the row. A
      // stale or mixed graph must not advance its pre-call state or notify a
      // participant from the wrong fixture boundary.
      if ((await queueFixtureMarker(pool, "entry", Number(w.id))) !== challengeMarker) {
        continue;
      }
      const eta = w.rank * perSlot;
      if (w.precalled_at || eta > threshold) continue;
      // Atomic claim before notifying: if a previous, still-running tick (or
      // another worker process) already claimed this entry, the WHERE clause
      // matches zero rows here and this tick skips the notify entirely,
      // closing the read-then-write race that could double-send a pre-call.
      const { rows: claimed } = await pool.query(
        `UPDATE queue_entries SET precalled_at = now()
          WHERE id = $1 AND precalled_at IS NULL
          RETURNING id`,
        [w.id],
      );
      if (claimed.length === 0) continue;
      await notifyTeamPreCall(pool, {
        entryId: w.id,
        challengeId,
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
