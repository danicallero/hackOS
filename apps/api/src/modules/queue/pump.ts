import { pool } from "../../db/pool.js";
import { ConflictError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { notifyTeamPreCall } from "./notify.js";
import { callNextForRoom } from "./service.js";

/**
 * Queue pump (plan/07 §5.1). For every active, non-paused room, top up
 * `called` entries up to room_queue_state.max_in_waiting_area from the
 * shared challenge queue, honouring position/priority and the H30
 * member-busy guard (all inside callNextForRoom). Challenges whose sponsor
 * opted out of the live queue never block anything here because they were
 * never `enqueue`d in the first place (queue_entries only exist for
 * challenges an admin explicitly enqueued).
 */
export const QUEUE_PUMP_QUEUE_NAME = "queue-pump";

export async function pumpTick(): Promise<void> {
  const { rows: rooms } = await pool.query(
    `SELECT r.id FROM rooms r
       JOIN room_queue_state rqs ON rqs.room_id = r.id
      WHERE r.status = 'active' AND rqs.is_paused = false`,
  );

  for (const room of rooms as { id: number }[]) {
    // Top up until full or nobody eligible; callNextForRoom itself is the
    // atomic, race-safe unit — looping here just drains the room's slack.
    for (let i = 0; i < 50; i++) {
      let entry: Awaited<ReturnType<typeof callNextForRoom>>;
      try {
        entry = await callNextForRoom(null, room.id, { force: false });
      } catch (err) {
        if (err instanceof ConflictError) break; // full or paused mid-loop
        throw err;
      }
      if (!entry) break;
    }
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
      await notifyTeamPreCall(pool, {
        entryId: w.id,
        challengeId,
        repoId: w.repo_id,
        etaMinutes: Math.round(eta),
      });
      await pool.query(`UPDATE queue_entries SET precalled_at = now() WHERE id = $1`, [w.id]);
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
