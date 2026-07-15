import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
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
 * The single auto-fill gate is `room_queue_state.is_paused` — the same flag
 * the H35 Pause/Resume operator lever writes and callNextForRoom checks.
 * Newly created rooms initialise this state as paused, so their queue cannot
 * fill until a judge/operator explicitly resumes the room. `rooms.status`
 * remains a display/lifecycle field only.
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
    `SELECT 1 FROM room_queue_state WHERE room_id = $1 AND is_paused = false`,
    [roomId],
  );
  if (rows.length === 0) return; // paused (or unknown room): never auto-fill

  // callNextForRoom is the atomic, race-safe unit — looping here just drains
  // the room's slack until full or nobody eligible.
  for (let i = 0; i < 50; i++) {
    let entry: Awaited<ReturnType<typeof callNextForRoom>>;
    try {
      entry = await callNextForRoom(null, roomId, { force: false });
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
    `SELECT room_id AS id FROM room_queue_state WHERE is_paused = false`,
  );

  for (const room of rooms as { id: number }[]) {
    await topUpRoom(room.id);
  }

  await emitPreCallWarnings();
}

async function challengeEtaMinutesPerSlot(challengeId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(AVG(rqs.desired_minutes_per_team), 8) AS avg, COUNT(*)::int AS rooms
       FROM room_challenges rc
       JOIN room_queue_state rqs ON rqs.room_id = rc.room_id
      WHERE rc.challenge_id = $1`,
    [challengeId],
  );
  const avg = Number(rows[0].avg);
  const roomCount = Math.max(1, Number(rows[0].rooms));
  return avg / roomCount;
}

/** H38 pre-aviso: notify once per call cycle when ETA <= queue_settings.pre_call_notification_eta_minutes. */
async function emitPreCallWarnings(): Promise<void> {
  const settings = (
    await pool.query(`SELECT pre_call_notification_eta_minutes FROM queue_settings WHERE id = 1`)
  ).rows[0];
  const threshold = settings?.pre_call_notification_eta_minutes ?? 10;

  const { rows: challengeIds } = await pool.query(
    `SELECT DISTINCT challenge_id FROM queue_entries WHERE status = 'waiting'`,
  );

  for (const { challenge_id: challengeId } of challengeIds as { challenge_id: number }[]) {
    const perSlot = await challengeEtaMinutesPerSlot(challengeId);
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
