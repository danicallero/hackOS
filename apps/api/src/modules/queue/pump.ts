import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { afterCommit } from "../../lib/after-commit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { queueFixtureMarker } from "./broadcast.js";
import { findBusyMemberRepoIds } from "./guard.js";
import { prepareTeamPreCalls } from "./notify.js";
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
  await fillRoom(roomId);
}

/** Drain a room's slack; the caller has already checked the room is active. */
async function fillRoom(roomId: number): Promise<void> {
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
  // Only rooms that can actually take a call this tick: not paused, inside the
  // judging window, below their waiting-area cap and with a waiting team in the
  // queue they serve. Full or idle rooms used to cost a `callNextForRoom`
  // transaction each, every tick, just to learn there was nothing to do. The
  // check is a lock-free hint; `callNextForRoom` re-verifies under lock.
  const { rows: rooms } = await pool.query(
    `SELECT rqs.room_id AS id
       FROM room_queue_state rqs
       JOIN rooms r ON r.id = rqs.room_id
       JOIN queue_settings qs ON qs.id = 1
      WHERE rqs.is_paused = false
        AND (qs.schedule_start_at IS NULL OR qs.schedule_start_at <= now())
        AND (qs.schedule_end_at IS NULL OR qs.schedule_end_at > now())
        AND (SELECT count(*) FROM queue_entries called
              WHERE called.assigned_room_id = rqs.room_id AND called.status = 'called'
            ) < rqs.max_in_waiting_area
        AND EXISTS (
          SELECT 1
            FROM room_queue_groups rqg
            JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
            JOIN queue_entries waiting ON waiting.challenge_id = qgc.challenge_id
                                      AND waiting.status = 'waiting'
           WHERE rqg.room_id = rqs.room_id
        )
      ORDER BY rqs.room_id`,
  );

  for (const room of rooms as { id: number }[]) {
    await fillRoom(room.id);
  }

  await emitPreCallWarnings();
}

type DueTeam = { repo_id: number; eta_minutes: number };

type PreCallClaim = {
  id: number;
  challenge_id: number;
  repo_id: number;
  eta_minutes: number;
};

/**
 * H38: claim every due logical team's pre-call cycle in ONE queue group, in a
 * single lock-holding transaction (previously one transaction per team).
 *
 * The group row serialises all pump workers for a merged queue, so two
 * overlapping ticks cannot both claim: the loser waits, then finds the teams
 * already warned. Under that lock the room states and every entry are locked
 * once in id order, the fixture marker is re-verified, and the due set (rank
 * x minutes-per-slot <= threshold, not yet warned) is recomputed. H30
 * eligibility/occupancy is then checked for all due repos with the locks
 * taken in a global order, and one set-based UPDATE claims every waiting
 * sibling of the survivors, returning only each team's canonical row (the
 * only row allowed to drive the notification). Notifications go through one
 * `notifyMany`; the member SSE push runs after commit so a slow Valkey never
 * holds the group/entry locks.
 */
async function claimPreCallsForGroup(queueGroupId: number): Promise<PreCallClaim[]> {
  let publish: (() => Promise<void>) | null = null;
  const claimed = await withTransaction(async (client): Promise<PreCallClaim[]> => {
    const { rows: groupRows } = await client.query(
      `SELECT id FROM queue_groups WHERE id = $1 FOR UPDATE`,
      [queueGroupId],
    );
    if (groupRows.length === 0) return [];

    const { rows: settingsRows } = await client.query(
      `SELECT pre_call_notification_eta_minutes,
              (schedule_start_at IS NULL OR schedule_start_at <= now())
              AND (schedule_end_at IS NULL OR schedule_end_at > now()) AS window_open
         FROM queue_settings WHERE id = 1 FOR SHARE`,
    );
    const settings = settingsRows[0] as
      | { pre_call_notification_eta_minutes: number; window_open: boolean }
      | undefined;
    if (!settings?.window_open) return [];
    const threshold = Number(settings.pre_call_notification_eta_minutes ?? 10);

    // Resolve the complete graph after the group lock. A mixed or markerless
    // graph must never fall back to the real notification path.
    const groupMarker = await queueFixtureMarker(client, "queueGroup", queueGroupId);
    if (groupMarker === null) return [];

    // Lock every currently serving room state before checking the gate so
    // pauseRoom cannot commit between this read and the claim. The group lock
    // already keeps setQueueGroupRooms from changing the serving set.
    const { rows: servingRooms } = await client.query<{ room_id: number; is_paused: boolean }>(
      `SELECT rqs.room_id, rqs.is_paused
         FROM room_queue_groups rqg
         JOIN room_queue_state rqs ON rqs.room_id = rqg.room_id
        WHERE rqg.queue_group_id = $1
        ORDER BY rqs.room_id
        FOR UPDATE OF rqs`,
      [queueGroupId],
    );
    if (!servingRooms.some((room) => room.is_paused === false)) return [];

    // Lock every entry in the group (id order, matching queue ordering and
    // call_next) so a concurrent call/requeue cannot change the line between
    // the due computation and the claim.
    await client.query(
      `SELECT qe.id
         FROM queue_group_challenges qgc
         JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
        WHERE qgc.queue_group_id = $1
        ORDER BY qe.id
        FOR UPDATE`,
      [queueGroupId],
    );

    // An entry can be inserted while the first marker inspection runs.
    // Re-resolve after taking the entry locks so a newly mixed graph fails
    // closed before any state or notification is produced.
    if ((await queueFixtureMarker(client, "queueGroup", queueGroupId)) !== groupMarker) return [];

    // Canonical line item per team, true rank (warned teams keep their slot)
    // and ETA, all computed once under lock. Pace is a property of the shared
    // queue (#997: queue_group_pace) read through the locked client.
    const { rows: due } = await client.query<DueTeam>(
      `WITH group_waiting AS (
         SELECT qe.id, qe.repo_id, qe.position, qe.precalled_at,
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
         SELECT gw.repo_id,
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
            AND NOT EXISTS (
              SELECT 1 FROM group_waiting warned
               WHERE warned.repo_id = gw.repo_id AND warned.precalled_at IS NOT NULL
            )
       )
       SELECT ranked.repo_id,
              (ranked.rank * pace.minutes_per_slot)::double precision AS eta_minutes
         FROM ranked, queue_group_pace($1) pace
        WHERE ranked.rank * pace.minutes_per_slot <= $3
        ORDER BY ranked.rank`,
      [queueGroupId, groupMarker, threshold],
    );
    if (due.length === 0) return [];

    // H30/H38: ineligible projects are skipped, and a team already busy
    // elsewhere is not warned as if it were approaching this queue.
    const dueRepoIds = due.map((team) => Number(team.repo_id));
    const { rows: ineligibleRows } = await client.query<{ repo_id: number }>(
      `SELECT repo_id FROM project_eligibility WHERE repo_id = ANY($1::int[]) AND eligible = false`,
      [dueRepoIds],
    );
    const ineligible = new Set(ineligibleRows.map((row) => Number(row.repo_id)));
    const eligibleRepoIds = dueRepoIds.filter((id) => !ineligible.has(id));
    const busy = await findBusyMemberRepoIds(client, eligibleRepoIds, {
      fixtureMarker: groupMarker,
    });
    const claimRepoIds = eligibleRepoIds.filter((id) => !busy.has(id));
    if (claimRepoIds.length === 0) return [];
    const etaByRepo = new Map(due.map((team) => [Number(team.repo_id), Number(team.eta_minutes)]));

    // Claim every still-waiting sibling of each surviving team, returning only
    // its best row. The status + NULL predicates keep this atomic against any
    // transition that raced the scan.
    const { rows: claimedRows } = await client.query<{
      id: number;
      challenge_id: number;
      repo_id: number;
    }>(
      `WITH claimable AS (
         SELECT qe.id
           FROM queue_entries qe
           JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
           JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
           JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
          WHERE qgc.queue_group_id = $1
            AND qe.repo_id = ANY($3::int[])
            AND qe.status = 'waiting'
            AND qe.precalled_at IS NULL
          ORDER BY qe.id
       ), claimed AS (
         UPDATE queue_entries qe
            SET precalled_at = now()
           FROM claimable c
          WHERE qe.id = c.id
            AND qe.status = 'waiting'
            AND qe.precalled_at IS NULL
          RETURNING qe.id, qe.challenge_id, qe.repo_id, qe.position
       )
       SELECT DISTINCT ON (repo_id) id, challenge_id, repo_id
         FROM claimed
        ORDER BY repo_id, position ASC NULLS LAST, id ASC`,
      [queueGroupId, groupMarker, claimRepoIds],
    );
    const result: PreCallClaim[] = claimedRows.map((row) => ({
      id: Number(row.id),
      challenge_id: Number(row.challenge_id),
      repo_id: Number(row.repo_id),
      eta_minutes: etaByRepo.get(Number(row.repo_id)) ?? threshold,
    }));
    if (result.length === 0) return [];

    publish = await prepareTeamPreCalls(
      client,
      result.map((team) => ({
        entryId: team.id,
        challengeId: team.challenge_id,
        repoId: team.repo_id,
        etaMinutes: Math.round(team.eta_minutes),
      })),
      groupMarker,
    );
    return result;
  });
  const after = publish as (() => Promise<void>) | null;
  if (after) await afterCommit(`pre-call group ${queueGroupId} publish`, after);
  return claimed;
}

/**
 * H38 pre-aviso: notify once per call cycle when ETA <= queue_settings.pre_call_notification_eta_minutes.
 *
 * Discovery is a lock-free, set-based pre-filter per queue group: it ranks the
 * group's waiting teams like `claimPreCallsForGroup` and only groups with at
 * least one team inside the threshold and not yet warned pay for the locking
 * claim transaction. That transaction is one per group (not per team), and it
 * re-verifies everything under lock, so a stale snapshot is harmless.
 */
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
  const threshold = Number(settings.pre_call_notification_eta_minutes ?? 10);

  // Groups with at least one team that has not been warned this cycle and a
  // serving room that is not paused.
  const { rows: groups } = await pool.query<{ queue_group_id: number }>(
    `SELECT DISTINCT qgc.queue_group_id
       FROM queue_group_challenges qgc
       JOIN room_queue_groups rqg ON rqg.queue_group_id = qgc.queue_group_id
       JOIN room_queue_state rqs ON rqs.room_id = rqg.room_id AND rqs.is_paused = false
      WHERE EXISTS (
        SELECT 1 FROM queue_entries qe
         WHERE qe.challenge_id = qgc.challenge_id
           AND qe.status = 'waiting'
           AND qe.precalled_at IS NULL
      )
      ORDER BY qgc.queue_group_id`,
  );

  for (const { queue_group_id } of groups) {
    const queueGroupId = Number(queue_group_id);
    const marker = await queueFixtureMarker(pool, "queueGroup", queueGroupId);
    if (marker === null) continue;
    const { rows: candidates } = await pool.query<{ repo_id: number }>(
      `WITH group_waiting AS (
         SELECT qe.id, qe.repo_id, qe.position, qe.precalled_at,
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
       ), ranked AS (
         SELECT gw.repo_id,
                ROW_NUMBER() OVER (ORDER BY gw.position ASC NULLS LAST, gw.id ASC) AS rank
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
            AND NOT EXISTS (
              SELECT 1 FROM group_waiting warned
               WHERE warned.repo_id = gw.repo_id AND warned.precalled_at IS NOT NULL
            )
       )
       SELECT ranked.repo_id
         FROM ranked, queue_group_pace($1) pace
        WHERE ranked.rank * pace.minutes_per_slot <= $3
        LIMIT 1`,
      [queueGroupId, marker, threshold],
    );
    if (candidates.length === 0) continue;
    await claimPreCallsForGroup(queueGroupId);
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
    {
      repeat: { every: intervalMs },
      jobId: "queue-pump-tick",
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
    },
  );
}
